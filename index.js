const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// MVP storage (replace with DB later)
const JOBS = new Map();

// Hardcoded tech list for MVP (replace with DB/on-call schedule later)
const TECHS = [
  { id: "tech_a", name: "Tech A", phone: "+14165550111" },
  { id: "tech_b", name: "Tech B", phone: "+14165550222" }
];

// Helper: build a tight spoken script (accuracy matters)
function buildTechScript(job) {
  const loc = job.location_text || "location not provided";
  const vehicle = job.vehicle || "vehicle details not provided";
  const notes = job.notes || "no additional notes";
  return `New roadside service call. Issue: ${job.issue_type}. Location: ${loc}. Vehicle: ${vehicle}. Notes: ${notes}. Driver callback: ${job.caller_phone}. Press 1 to accept. Press 2 to decline. Press 3 to repeat.`;
}

// ========== 1) Intake from Vapi ==========
app.post("/api/jobs/intake", async (req, res) => {
  const jobId = "JOB-" + Date.now();

  const job = {
    job_id: jobId,
    caller_name: req.body.caller_name || "",
    caller_phone: req.body.caller_phone,
    issue_type: req.body.issue_type,
    vehicle: req.body.vehicle,
    location_text: req.body.location_text,
    notes: req.body.notes,
    status: "new",
    offer_index: 0,
    assigned_tech_id: null
  };

  JOBS.set(jobId, job);

  // Immediately dispatch (you can instead wait for pin-confirm)
  await startDispatch(jobId);

  res.json({ job_id: jobId, status: "created_and_dispatching" });
});

// ========== Dispatch loop ==========
async function startDispatch(jobId) {
  const job = JOBS.get(jobId);
  if (!job) return;

  job.status = "offering";
  job.offer_index = 0;
  await callTech(jobId);
}

async function callTech(jobId) {
  const job = JOBS.get(jobId);
  if (!job) return;

  const tech = TECHS[job.offer_index];
  if (!tech) {
    job.status = "failed_no_tech";
    // TODO: escalate (text manager / human dispatcher)
    return;
  }

  // Place outbound call to tech
  await client.calls.create({
    to: tech.phone,
    from: process.env.TWILIO_PHONE,
    url: `${process.env.BASE_URL}/voice/offer?jobId=${jobId}&techId=${tech.id}`,
    statusCallback: `${process.env.BASE_URL}/voice/status?jobId=${jobId}&techId=${tech.id}`,
    statusCallbackEvent: ["no-answer", "busy", "failed", "completed"],
    timeout: 25
  });
}

// ========== 2) Tech answers: IVR reads job + gathers DTMF ==========
app.post("/voice/offer", (req, res) => {
  const { jobId, techId } = req.query;
  const job = JOBS.get(jobId);

  const script = job ? buildTechScript(job) : "Job not found. Please contact dispatch.";

  res.type("text/xml");
  res.send(`
<Response>
  <Gather numDigits="1" action="/voice/offer/choice?jobId=${jobId}&techId=${techId}" timeout="20">
    <Say>${script}</Say>
  </Gather>
  <Say>No response received.</Say>
</Response>
`);
});

// ========== 3) Handle keypress ==========
app.post("/voice/offer/choice", async (req, res) => {
  const { jobId, techId } = req.query;
  const digit = req.body.Digits;
  const job = JOBS.get(jobId);

  res.type("text/xml");

  if (!job) {
    return res.send(`<Response><Say>Job not found.</Say></Response>`);
  }

  if (digit === "1") {
    job.status = "assigned";
    job.assigned_tech_id = techId;

    // Text tech + driver (MVP)
    // NOTE: Twilio SMS requires your number to be SMS-enabled
    await client.messages.create({
      to: TECHS.find(t => t.id === techId).phone,
      from: process.env.TWILIO_PHONE,
      body: `Accepted ${job.job_id}. Location: ${job.location_text}. Callback: ${job.caller_phone}`
    });

    await client.messages.create({
      to: job.caller_phone,
      from: process.env.TWILIO_PHONE,
      body: `Request ${job.job_id} accepted. Tech is on the way. If anything changes, reply to this text.`
    });

    return res.send(`<Response><Say>Accepted. Details have been texted to you.</Say></Response>`);
  }

  if (digit === "2") {
    job.offer_index += 1; // next tech
    await callTech(jobId);
    return res.send(`<Response><Say>Declined. Calling next technician.</Say></Response>`);
  }

  // digit === "3" or anything else
  return res.send(`<Response><Redirect>/voice/offer?jobId=${jobId}&techId=${techId}</Redirect></Response>`);
});

// ========== 4) Status callback (no answer/busy) ==========
app.post("/voice/status", async (req, res) => {
  const { jobId } = req.query;
  const callStatus = req.body.CallStatus;

  const job = JOBS.get(jobId);

  // If tech didn't accept and call ended with no-answer/busy/failed, try next tech
  if (job && job.status === "offering" && ["no-answer", "busy", "failed"].includes(callStatus)) {
    job.offer_index += 1;
    await callTech(jobId);
  }

  res.sendStatus(200);
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
