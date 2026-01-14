const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.options("*", cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/health", (req, res) => res.json({ ok: true }));

// 🔑 THIS is the line you were asking about
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory job store (MVP only)
const JOBS = new Map();

// 👉 PUT *YOUR* phone number here for testing
const TECHS = [
  { id: "tech_a", name: "You", phone: "+19059956233" }
];

function buildTechScript(job) {
  const issue = job.issue_type || "not provided";
  const loc = job.location_text || "not provided";
  const vehicle = job.vehicle || "not provided";
  const notes = job.notes || "none";
  const cb = job.caller_phone || "not provided";

  return `New roadside service call. 
Issue: ${issue}. 
Location: ${loc}. 
Vehicle: ${vehicle}. 
Notes: ${notes}. 
Driver callback: ${cb}. 
Press 1 to accept. Press 2 to decline.`;
}



// Driver/AI intake endpoint
app.post("/api/jobs/intake", async (req, res) => {
  const jobId = "JOB-" + Date.now();

  const job = {
    job_id: jobId,
    caller_phone: req.body.caller_phone,
    issue_type: req.body.issue_type,
    vehicle: req.body.vehicle,
    location_text: req.body.location_text,
    notes: req.body.notes,
    offer_index: 0
  };

  JOBS.set(jobId, job);

  // Call the tech
  await client.calls.create({
    to: TECHS[0].phone,
    from: process.env.TWILIO_PHONE,
    url: `${process.env.BASE_URL}/voice/offer?jobId=${jobId}`
  });

  res.json({ job_id: jobId });
});

// Tech call IVR
app.post("/voice/offer", (req, res) => {
  const job = JOBS.get(req.query.jobId);

  res.type("text/xml");
  res.send(`
<Response>
  <Gather numDigits="1" action="/voice/offer/choice?jobId=${req.query.jobId}">
    <Say>${buildTechScript(job)}</Say>
  </Gather>
</Response>
`);
});

// Handle keypress
app.post("/voice/offer/choice", (req, res) => {
  res.type("text/xml");

  if (req.body.Digits === "1") {
    return res.send(`<Response><Say>Job accepted.</Say></Response>`);
  }

  return res.send(`<Response><Say>Job declined.</Say></Response>`);
});

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
