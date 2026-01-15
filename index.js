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

  return `New roadside service call. Issue: ${issue}. Location: ${loc}. Vehicle: ${vehicle}. Notes: ${notes}. Driver callback: ${cb}. Press 1 to accept. Press 2 to decline.`;
}

// Driver/AI intake endpoint
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

// Tech call IVR
app.post("/voice/offer", (req, res) => {
  const jobId = req.query.jobId;
  const job = JOBS.get(jobId) || null;

  res.type("text/xml");
  res.send(`
<Response>
  <Gather numDigits="1" action="/voice/offer/choice?jobId=${jobId}" timeout="20">
    <Say>${buildTechScript(job)}</Say>
  </Gather>
  <Say>No response received.</Say>
</Response>
`);
});

// Handle keypress
app.post("/voice/offer/choice", (req, res) => {
  const digit = req.body.Digits;

  res.type("text/xml");

  if (digit === "1") {
    return res.send(`<Response><Say>Job accepted.</Say></Response>`);
  }

  return res.send(`<Response><Say>Job declined.</Say></Response>`);
});

app.post("/vapi/webhook", async (req, res) => {
  // Optional security: verify secret from Vapi
  const incoming = req.header("X-Vapi-Secret");
  if (process.env.VAPI_SECRET && incoming !== process.env.VAPI_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const msg = req.body?.message;

  // Only tool-calls require a JSON response
  if (!msg || msg.type !== "tool-calls") return res.sendStatus(200);

  const toolCalls = msg.toolCallList || [];
  const results = [];

  for (const tc of toolCalls) {
    if (tc.name !== "create_service_job") {
      results.push({
        toolCallId: tc.id,
        result: { ok: false, error: "unknown_tool" }
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

      // Store for the tech-call IVR to read
      JOBS.set(jobId, job);

      // Call the tech
      await client.calls.create({
        to: TECHS[0].phone,
        from: process.env.TWILIO_PHONE,
        url: `${process.env.BASE_URL}/voice/offer?jobId=${encodeURIComponent(jobId)}`
      });

      results.push({
        toolCallId: tc.id,
        result: { ok: true, job_id: jobId, status: "calling_tech" }
      });
    } catch (e) {
      console.error("VAPI DISPATCH ERROR:", e?.message || e);
      results.push({
        toolCallId: tc.id,
        result: { ok: false, error: "dispatch_failed" }
      });
    }
  }

  return res.json({ results });
});

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
