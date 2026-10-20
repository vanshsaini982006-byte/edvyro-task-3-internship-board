# API examples

Base URL: `http://localhost:3000/api` (start the server first with `npm start`).

All responses shown below are real output from a running server. IDs and counts match a fresh database with the five seed records.

## macOS / Linux / Git Bash (cURL)

### Health
```bash
curl http://localhost:3000/api/health
```
```json
{"status":"success","data":{"message":"Internship API is running"}}
```

### List, pagination, search, filters
```bash
curl http://localhost:3000/api/internships
curl "http://localhost:3000/api/internships?page=1&limit=2"
curl "http://localhost:3000/api/internships?search=frontend"
curl "http://localhost:3000/api/internships?domain=UI/UX"
curl "http://localhost:3000/api/internships?mode=Remote"
curl "http://localhost:3000/api/internships?search=intern&domain=Full%20Stack%20Development&mode=Remote&page=1&limit=5"
```

`?search=frontend` returns:
```json
{"status":"success","data":[{"id":"INT-101","title":"Frontend Intern","domain":"Full Stack Development","mode":"Remote","location":"India","skills":["HTML","CSS","JavaScript"],"openings":3}],"pagination":{"page":1,"limit":10,"total":1,"totalPages":1}}
```

`?mode=Remote&limit=2` returns 2 of 3 records: `"pagination":{"page":1,"limit":2,"total":3,"totalPages":2}`.

### Detail
```bash
curl http://localhost:3000/api/internships/INT-101
```
```json
{"status":"success","data":{"id":"INT-101","title":"Frontend Intern","domain":"Full Stack Development","mode":"Remote","location":"India","skills":["HTML","CSS","JavaScript"],"openings":3}}
```

Missing record (HTTP 404):
```bash
curl -i http://localhost:3000/api/internships/INVALID
```
```json
{"status":"error","error":{"code":"INTERNSHIP_NOT_FOUND","message":"Internship not found"}}
```

### Create (HTTP 201)
```bash
curl -X POST http://localhost:3000/api/internships \
  -H "Content-Type: application/json" \
  -d '{"id":"INT-106","title":"Backend Developer Intern","domain":"Full Stack Development","mode":"Remote","location":"India","skills":["Node.js","Express"],"openings":2}'
```
```json
{"status":"success","data":{"id":"INT-106","title":"Backend Developer Intern","domain":"Full Stack Development","mode":"Remote","location":"India","skills":["Node.js","Express"],"openings":2}}
```

Creating an ID that exists (HTTP 409):
```json
{"status":"error","error":{"code":"DUPLICATE_ID","message":"An internship with this ID already exists"}}
```

Invalid data (HTTP 400), for example `{"id":"INT-107","openings":-1}`:
```json
{"status":"error","error":{"code":"VALIDATION_ERROR","message":"Invalid internship data","fields":{"title":"Title is required","domain":"Domain is required","location":"Location is required","mode":"Mode is required","skills":"Skills are required","openings":"Openings must be a non-negative integer"}}}
```

### Update (HTTP 200)
```bash
curl -X PUT http://localhost:3000/api/internships/INT-106 \
  -H "Content-Type: application/json" \
  -d '{"title":"Backend Engineer Intern","domain":"Full Stack Development","mode":"Hybrid","location":"Pune","skills":["Node.js","Express","SQLite"],"openings":4}'
```
```json
{"status":"success","data":{"id":"INT-106","title":"Backend Engineer Intern","domain":"Full Stack Development","mode":"Hybrid","location":"Pune","skills":["Node.js","Express","SQLite"],"openings":4}}
```

### Delete (HTTP 200)
```bash
curl -X DELETE http://localhost:3000/api/internships/INT-106
```
```json
{"status":"success","data":{"message":"Internship deleted successfully"}}
```

### Apply (HTTP 201)
```bash
curl -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{"internship_id":"INT-101","applicant_name":"John Doe","applicant_email":"john@example.com"}'
```
```json
{"status":"success","data":{"message":"Application submitted successfully","application_id":1}}
```

Same email again (HTTP 409):
```json
{"status":"error","error":{"code":"DUPLICATE_APPLICATION","message":"This applicant has already applied for this internship"}}
```

Invalid email (HTTP 400):
```json
{"status":"error","error":{"code":"VALIDATION_ERROR","message":"Invalid application data","fields":{"applicant_email":"Applicant email must be a valid email address"}}}
```

Unknown route (HTTP 404):
```json
{"status":"error","error":{"code":"ROUTE_NOT_FOUND","message":"API route not found"}}
```

## Windows PowerShell

In PowerShell, `curl` is not real cURL. Use `Invoke-RestMethod` (shows the parsed JSON) as below, or type `curl.exe` instead of `curl`.

```powershell
# Health, list, search, filter
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod "http://localhost:3000/api/internships?page=1&limit=2"
Invoke-RestMethod "http://localhost:3000/api/internships?search=frontend"
Invoke-RestMethod "http://localhost:3000/api/internships?mode=Remote"

# Detail
Invoke-RestMethod http://localhost:3000/api/internships/INT-101

# Create
$body = @{
  id = "INT-106"; title = "Backend Developer Intern"; domain = "Full Stack Development"
  mode = "Remote"; location = "India"; skills = @("Node.js","Express"); openings = 2
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/internships -ContentType "application/json" -Body $body

# Update
$update = @{
  title = "Backend Engineer Intern"; domain = "Full Stack Development"; mode = "Hybrid"
  location = "Pune"; skills = @("Node.js","Express","SQLite"); openings = 4
} | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri http://localhost:3000/api/internships/INT-106 -ContentType "application/json" -Body $update

# Apply
$apply = @{ internship_id = "INT-101"; applicant_name = "John Doe"; applicant_email = "john@example.com" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/applications -ContentType "application/json" -Body $apply

# Delete
Invoke-RestMethod -Method Delete -Uri http://localhost:3000/api/internships/INT-106
```

Error responses (400, 404, 409) make `Invoke-RestMethod` throw. To see the JSON body of an error, use `curl.exe -i ...` instead.


---

## Task 3: applications (updated)

`POST /api/applications` now requires `resume_url` and accepts an optional `cover_letter`.
Examples use `curl.exe` on Windows PowerShell (single quotes around JSON do not work there, so use a file):

```powershell
'{"internship_id":"INT-101","applicant_name":"Asha Verma","applicant_email":"asha@example.com","resume_url":"https://example.com/asha.pdf","cover_letter":"Hello"}' | Out-File -Encoding ascii application.json
curl.exe -s -X POST http://localhost:3000/api/applications -H "Content-Type: application/json" --data-binary "@application.json"
```

| Case | Status | `error.code` |
|------|--------|--------------|
| Valid application | 201 | (success) |
| Invalid or missing field, unsafe resume URL | 400 | `VALIDATION_ERROR` (with `error.fields`) |
| Malformed JSON | 400 | `INVALID_JSON` |
| Body larger than 10 KB | 400 | `PAYLOAD_TOO_LARGE` |
| Unknown internship | 404 | `INTERNSHIP_NOT_FOUND` |
| Same email applied to the same internship before | 409 | `DUPLICATE_APPLICATION` |
| Body is not JSON | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Too many requests | 429 | `RATE_LIMITED` |
| Unexpected failure | 500 | `INTERNAL_SERVER_ERROR` (generic message) |

201 response:

```json
{ "status": "success", "data": { "message": "Application submitted successfully", "application_id": 1, "internship_id": "INT-101" } }
```

400 response (same envelope as every other error in this API):

```json
{
  "status": "error",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the submitted information.",
    "fields": { "resume_url": "Resume URL must start with http:// or https://" }
  }
}
```

---

## Task 4 additions

### `GET /api/health`

```powershell
curl.exe -s http://localhost:3000/api/health
```

```json
{ "status": "success", "data": { "message": "Internship API is running", "database": "ok", "uptime_seconds": 12, "version": "1.0.0" } }
```

If the database cannot be reached the response is `503` with `{ "status": "error", "error": { "code": "SERVICE_UNAVAILABLE", "message": "Service temporarily unavailable" } }`. This endpoint is not counted by the rate limiter.

### `GET /api/domains`

```powershell
curl.exe -s http://localhost:3000/api/domains
```

```json
{ "status": "success", "data": ["Cyber Security", "Data Analytics", "Full Stack Development", "UI/UX"] }
```

### Request IDs and caching

Every response has an `X-Request-Id` header. You may send your own (letters, numbers, `.`, `_`, `-`, up to 64 characters); anything else is replaced. `GET` responses carry an `ETag` and `Cache-Control: no-cache`, so a repeat request with `If-None-Match` returns `304` with no body. Application responses are `Cache-Control: no-store`.
