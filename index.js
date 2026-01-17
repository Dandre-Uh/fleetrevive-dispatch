const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.options("*", cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// MVP in-memory store
const JOBS = new Map();

// ✅ For testing, put your phone here (E.164 format)
const TECHS = [{ id: "tech_a", name: "You", phone: "+19059956233" }];

function buildTechScript(job) {
  const issue = job?.issue_type || "not provided";
  const loc = job?.location_text || "not provided";
  const vehicle = job?.vehicle || "not provided";
  const notes = job?.notes || "none";
  const cb = job?.caller_phone || "not provided";

  return `New roadside service call. Issue: ${issue}. Location: ${loc}. Vehicle: ${vehicle}. Notes: ${notes}. Driver callback: ${cb}. Press 1 to accept. Press 2 to decline. Press 3 to repeat.`;
}

// ===============================
// Manual intake endpoint (optional)
// ===============================
app.post("/api/jobs/intake", async (req, res) => {
  console.log("INTAKE BODY:", req.body);

  const jobId = "JOB-" + Date.now();

  const job = {
    job_id: jobId,
    caller_phone: req.body.caller_phone,
    issue_type: req.body.issue_type,
    vehicle: req.body.vehicle,
    location_text: req.body.location_text,
    notes: req.body.notes
  };

  JOBS.set(jobId, job);

  try {
    await client.calls.create({
      to: TECHS[0].phone,
      from: process.env.TWILIO_PHONE,
      url: `${process.env.BASE_URL}/voice/offer?jobId=${encodeURIComponent(jobId)}`
    });

    return res.json({ job_id: jobId, status: "calling_tech" });
  } catch (err) {
    console.error("TWILIO CALL ERROR:", err?.message || err);
    return res.status(500).json({ error: "twilio_call_failed", message: err?.message });
  }
});

// ===============================
// Tech call IVR (Twilio hits this)
// ===============================
app.post("/voice/offer", (req, res) => {
  const jobId = req.query.jobId;
  const job = JOBS.get(jobId) || null;

  res.type("text/xml");
  res.send(`
<Response>
  <Gather numDigits="1" action="${process.env.BASE_URL}/voice/offer/choice?jobId=${encodeURIComponent(jobId)}" timeout="20">
    <Say>${buildTechScript(job)}</Say>
  </Gather>
  <Say>No response received.</Say>
</Response>
`);
});

// ===============================
// Handle tech keypress
// ===============================
app.post("/voice/offer/choice", (req, res) => {
  const jobId = req.query.jobId;
  const digit = req.body.Digits;

  res.type("text/xml");

  if (digit === "1") {
    // TODO: mark assigned in DB
    return res.send(`<Response><Say>Job accepted. Thank you.</Say></Response>`);
  }

  if (digit === "3") {
    // Repeat the message
    return res.send(
      `<Response><Redirect>${process.env.BASE_URL}/voice/offer?jobId=${encodeURIComponent(
        jobId
      )}</Redirect></Response>`
    );
  }

  return res.send(`<Response><Say>Job declined.</Say></Response>`);
});

// ===============================
// Vapi Webhook (GET + POST)
// ===============================

// ✅ Vapi (or its UI) may ping with GET
app.get("/vapi/webhook", (req, res) => {
  return res.status(200).send("ok");
});

// ✅ Vapi tool-calls arrive here
app.post("/vapi/webhook", async (req, res) => {
  // Vapi sends: x-vapi-secret: YOUR_TOKEN (no Bearer)
  const incoming = (req.header("x-vapi-secret") || "").trim();
  const expected = (process.env.VAPI_SECRET || "").trim();

  if (expected && incoming !== expected) {
    console.log("❌ Vapi webhook unauthorized");
    return res.status(401).json({ error: "unauthorized" });
  }

  const msg = req.body?.message;

  // Non-tool-call events: just acknowledge
  if (!msg || msg.type !== "tool-calls") return res.sendStatus(200);

  const toolCalls = msg.toolCallList || [];
  const results = [];

  for (const tc of toolCalls) {
  console.log("TOOL CALL RECEIVED:", tc.name, tc.parameters);

  if (tc.name !== "create_service_job") {
    results.push({
      toolCallId: tc.id,
      result: JSON.stringify({ ok: false, error: "unknown_tool" })
    });
    continue;
  }

  try {
    const body = tc.parameters || {};
    const jobId = "JOB-" + Date.now();

    const job = {
      job_id: jobId,
      caller_phone: body.caller_phone,
      issue_type: body.issue_type,
      vehicle: body.vehicle,
      location_text: body.location_text,
      notes: body.notes
    };

    JOBS.set(jobId, job);

    // 👇 TWILIO CODE GOES HERE
    const call = await client.calls.create({
      to: TECHS[0].phone,
      from: process.env.TWILIO_PHONE,
      url: `${process.env.BASE_URL}/voice/offer?jobId=${encodeURIComponent(jobId)}`
    });

    console.log("TWILIO CALL CREATED:", call.sid);

    results.push({
      toolCallId: tc.id,
      result: JSON.stringify({ ok: true, job_id: jobId, status: "calling_tech" })
    });
  } catch (e) {
    console.error("VAPI DISPATCH ERROR:", e?.message || e);
    results.push({
      toolCallId: tc.id,
      result: JSON.stringify({ ok: false, error: "dispatch_failed" })
    });
      } // end try/catch
} // end for loop

  return res.json({ results });
}); // end /vapi/webhook route

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
