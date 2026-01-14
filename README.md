# fleetrevive-dispatch
---

## 🧪 Testing with Hoppscotch (Recommended)

Hoppscotch is a browser-based API client you can use to trigger test jobs without installing Postman.

### 1) Open Hoppscotch
Go to: https://hoppscotch.io

### 2) Configure the request
Set:

- **Method:** `POST`
- **URL:**
https://fleetrevive-ai-voice-1423edc53f58.herokuapp.com/api/jobs/intake

csharp
Copy code

### 3) Add required headers
Click the **Headers** tab and add:

- **Key:** `Content-Type`
- **Value:** `application/json`

⚠️ This header is required. If you skip it, the server will log `INTAKE BODY: {}` and the technician call will say “not provided”.

### 4) Add the JSON body
Click the **Body** tab and choose **JSON**.

Paste this:

```json
{
"caller_phone": "+19059956233",
"issue_type": "Tire service",
"vehicle": "Unit 7341, 11R22.5",
"location_text": "401 EB near Markham Rd exit",
"notes": "Trailer tire shredded"
}
5) Send the request
Click Send.

6) Expected behavior
The technician phone number configured in TECHS will ring.

The call will read the job details by voice.

The technician can respond:

Press 1 → Accept job

Press 2 → Decline job

7) Debugging (if it reads “not provided”)
Check Heroku logs:
Heroku Dashboard → App → More → View logs

If you see:

css
Copy code
INTAKE BODY: {}
Then Hoppscotch did not send the header or JSON body correctly.
Re-check:

Headers include Content-Type: application/json

Body tab is set to JSON

The payload includes { } braces and valid JSON formatting
