# Internship Board

A responsive internship board with a REST API, SQLite storage and a secure application form.
Built for **EdVyro Full Stack Development**: Task 1 (frontend), Task 2 (REST API and persistent data) and **Task 3 (secure application integration)**, all in one project.

## 1. Features

- Browse internships fetched from the real REST API (no hardcoded records in the frontend)
- Search by title, domain, location and skill; filter by domain and work mode; pagination
- Details dialog with an **Apply** form: full name, email, resume link, optional cover letter, linked to the selected internship
- Loading, success, empty, error (with working **Try again**) and form feedback states: submitting, validation error, duplicate application, rate limit, server error
- Server-side validation of every field (the browser checks are only a convenience)
- Applications saved in SQLite; duplicates blocked by a database UNIQUE rule
- Secure headers (Helmet + strict CSP), rate limiting, request size and content-type limits, configurable CORS, safe error handling
- Full CRUD for internships (Task 2), unchanged
- 137 automated tests

## 2. Architecture and request flow

```
Browser (public/index.html, app.js, styles.css)
   |  fetch /api/...   (JSON)
   v
Express app (src/app.js)
   1. Helmet security headers
   2. CORS policy (off unless CORS_ORIGIN is set)
   3. General rate limit  ->  429 RATE_LIMITED
   4. Content-Type check  ->  415
   5. JSON body parser (10 KB limit)
   6. Routes -> validation middleware -> controller
   |              (400)                   (404 / 409 / 201)
   v
SQLite via node:sqlite (src/db.js)  -- parameterised queries only
   7. Central error handler -> safe JSON error, never a stack trace
```

`POST /api/applications` additionally passes a stricter rate limiter (step 3b) before validation.
The frontend and API are served by the same Express server, so no CORS setup is needed by default.

## 3. Folder structure

```
database/        schema.sql, seed.sql (internship-board.db is created on first start, not committed)
docs/            api-examples.md, test-report.md, walkthrough.md
public/          index.html, app.js, styles.css  (frontend)
src/
  app.js         builds the Express app (createApp)
  server.js      loads .env and starts listening
  config.js      reads environment variables with safe defaults
  db.js          opens SQLite, creates tables, migrates, seeds
  controllers/   internshipController.js, applicationController.js
  middleware/    errorHandler.js, security.js, validation.js
  routes/        internships.js, applications.js
  utils/         response.js  (response envelope + ApiError)
tests/           api, persistence, applications, security, frontend tests (+ helpers.js)
.env.example     placeholders only
```

## 4. Prerequisites

- **Node.js 22.13 or newer** (uses the built-in `node:sqlite` module, so nothing native has to be compiled)
- npm (comes with Node.js)

## 5. Installation

```powershell
cd path\to\internship-board
npm install
Copy-Item .env.example .env
```

## 6. Environment variables

All optional. Copy `.env.example` to `.env`; never commit `.env`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Port to listen on |
| `NODE_ENV` | (unset) | `production` turns on `upgrade-insecure-requests` in the CSP |
| `DATABASE_PATH` | `./database/internship-board.db` | SQLite file |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Rate-limit window |
| `RATE_LIMIT_API_MAX` | `300` | Requests per window per IP for the whole API |
| `RATE_LIMIT_APPLICATION_MAX` | `10` | Application submissions per window per IP |
| `CORS_ORIGIN` | empty | Exact frontend origin(s) allowed to call the API from another site, comma separated. Empty = no cross-origin access |
| `PUBLIC_API_BASE_URL` | empty | API origin the browser should use. Empty = same server |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the app |

## 7. Database setup

The schema is applied automatically on every start (`CREATE TABLE IF NOT EXISTS`), so no manual step is needed. To do it by hand:

```powershell
npm run db:init
```

**Upgrading a Task 2 database:** Task 3 adds `resume_url` and `cover_letter` to `applications`. On start, `src/db.js` adds any missing column with `ALTER TABLE`. Existing rows are kept (the new columns are `NULL` for old applications), nothing is reset, and running it again does nothing. This was checked on a copy of the Task 2 database file.

Tables:

- `internships` (id, title, domain, mode, location, skills as JSON text, openings)
- `applications` (id, internship_id, applicant_name, applicant_email, resume_url, cover_letter, created_at) with `UNIQUE (internship_id, applicant_email)`, a foreign key to `internships`, and length CHECK constraints on `resume_url` (2048) and `cover_letter` (2000)

## 8. Seed commands

```powershell
npm run db:seed
```

Seeds INT-101 to INT-105 with `INSERT OR IGNORE`: safe to repeat, never overwrites or duplicates. The seed also runs once automatically when a brand-new database file is created.

## 9. Start the app

```powershell
npm start        # http://localhost:3000  (frontend and API together)
npm run dev      # same, restarts when files change
```

There is no separate frontend server. If you host the frontend elsewhere, set `PUBLIC_API_BASE_URL` (what the browser calls) and `CORS_ORIGIN` (who may call it) on the API server.

## 10. API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/internships?search=&domain=&mode=&page=&limit=` | List with pagination metadata |
| GET | `/api/internships/:id` | One internship (404 if unknown) |
| POST / PUT / DELETE | `/api/internships`, `/api/internships/:id` | Task 2 CRUD (unchanged) |
| POST | `/api/applications` | Submit an application |

Success: `{ "status": "success", "data": ..., "pagination": ... }` (pagination only on lists).
Error: `{ "status": "error", "error": { "code", "message", "fields"? } }` (the envelope from Task 2 was kept).

Example (PowerShell, using a file because PowerShell mangles inline JSON quotes):

```powershell
'{"internship_id":"INT-101","applicant_name":"Asha Verma","applicant_email":"asha@example.com","resume_url":"https://example.com/asha.pdf"}' | Out-File -Encoding ascii application.json
curl.exe -s -X POST http://localhost:3000/api/applications -H "Content-Type: application/json" --data-binary "@application.json"
```

More examples and the full status-code table: `docs/api-examples.md`.

## 11. Validation and duplicate prevention

| Field | Rule |
|-------|------|
| `internship_id` | required, letters / numbers / `-` / `_`, max 50, must exist (404 otherwise) |
| `applicant_name` | required, trimmed, inner spaces collapsed, 2 to 100 characters, no control characters |
| `applicant_email` | required, valid format, max 254 (local part max 64), no `..`, stored in lower case |
| `resume_url` | **required**, parsed with the `URL` parser, only `http:` or `https:`, no spaces, no embedded username/password, max 2048. `javascript:`, `data:`, `file:`, `ftp:` and others are rejected |
| `cover_letter` | optional, text only, max 2000, line breaks allowed, other control characters rejected, blank stored as NULL |
| anything else | ignored: the client cannot set `id`, `created_at` or any other column |

**Duplicate rule:** the same email address (compared case-insensitively after trimming) cannot apply to the same internship twice. It is enforced by the database `UNIQUE (internship_id, applicant_email)` constraint with a `NOCASE` email column. The application also looks first so it can answer with a friendly 409, but if two identical requests arrive together the database decides, and the loser still gets a clean 409. (Different spellings of one mailbox, such as Gmail dots or `+tags`, are treated as different emails.)

> **Contract change:** in Task 2 an application only needed a name and email. `resume_url` is now required, as the Task 3 brief asks. Task 2 clients that do not send it will get a 400. The existing Task 2 application tests were updated for this one field.

## 12. Security measures and limitations

| Measure | Details | Limitation |
|---------|---------|------------|
| Helmet headers | nosniff, frame protection, Referrer-Policy, HSTS | HSTS only matters over HTTPS |
| Content-Security-Policy | `default-src 'self'`, scripts and styles from this origin only, no inline code, no wildcards, `frame-ancestors 'none'` | A test checks the page has no inline script/style so the CSP cannot break it |
| Rate limiting | API-wide limit and a stricter limit on `POST /api/applications`, 429 `RATE_LIMITED` with `Retry-After` | In-memory and per server process. See the production notes below |
| Body protection | 10 KB JSON limit, 415 for non-JSON bodies, malformed JSON handled without echoing it | |
| CORS | No cross-origin access unless `CORS_ORIGIN` lists exact origins | |
| SQL safety | Every query uses `?` placeholders; search text is escaped for `LIKE` | A test checks the application controller for string-built SQL |
| Safe errors | Unexpected errors return a generic 500; stack traces are logged on the server only | Server logs may contain stack text |
| Privacy in logs | Only method, path, status and internship ID are logged: never names, emails, resume links or cover letters | |
| Frontend output | All API data is written with `textContent`, never `innerHTML` | |
| Secrets | `.env` is git-ignored; `.env.example` has placeholders only | The project has no secrets or authentication to protect. Authentication was not added because the existing API has none |

**Not protected against:** bots that rotate IP addresses (no CAPTCHA), fake email addresses (emails are not verified), and the resume link pointing to a harmful site (the server never opens it and the frontend never renders it as a link, but a reviewer who clicks it is on their own).

**Production notes for rate limiting:**

- Behind a reverse proxy (Render, Railway, nginx) set `TRUST_PROXY=1`. Without it every visitor shares the proxy's IP and gets limited together. With it set when there is *no* proxy, clients can fake their IP.
- Counters live in memory. If you run several instances, or restart often, each has its own counters. A shared store (for example Redis) is needed for strict global limits.
- The write path is a single SQLite file; this project is designed for a single server instance.

## 13. Automated tests

```powershell
npm test
```

Last actual result (Node.js v22.22.2, Linux): **137 tests, 137 passed, 0 failed.** Details and breakdown: `docs/test-report.md`.

Tests use throw-away database files in the system temp folder; your real database is never touched. The frontend tests run the real `index.html` and `app.js` in **jsdom** against the real Express API.

## 14. Responsive and accessibility verification

Automated (jsdom): form labels, `aria-describedby` links to error elements, `aria-invalid` on bad fields, focus moves to the first invalid field and to the success message, focus returns to the opening button when the dialog closes, double-submit is blocked.

**Still to do by you in a real browser. These have NOT been verified by me and are left unticked:**

- [ ] 360px width (DevTools device toolbar): no horizontal scrollbar on the list, the dialog and the form
- [ ] 768px and desktop widths look right
- [ ] Tab through the page: skip link, search, filters, cards, dialog, every form field, submit
- [ ] Visible focus outline on every control
- [ ] Esc closes the dialog and focus returns to the "View details" button
- [ ] Submit with errors: messages are shown next to the fields, and are announced by a screen reader (NVDA on Windows is free)
- [ ] Errors and success are not shown by colour alone (the messages start with the words "Error:" / "Success:")
- [ ] Stop the server, press Search: error message appears; start it again, press Try again: results return
- [ ] Contrast check of the muted text and error colours (for example with the DevTools contrast checker)

## 15. Deployment

Any Node.js 22.13+ host works (the Task 2 version is on Render).

1. Push the repository to GitHub.
2. Create a Web Service from the repo. Build command: `npm install`. Start command: `npm start`.
3. Set environment variables: `NODE_ENV=production`, `TRUST_PROXY=1`, and optionally the rate-limit values. Leave `CORS_ORIGIN` and `PUBLIC_API_BASE_URL` empty when the same service serves the page.
4. SQLite stores data in a file. On hosts with an ephemeral disk (Render free tier) data is lost on every deploy or restart unless you attach a persistent disk and point `DATABASE_PATH` at it (for example `/var/data/internship-board.db`).
5. Open `/api/health`, then submit a test application.

## 16. Live demo

🚀 Live Website:https://edvyro-task-3-internship-board.onrender.com

## 17. Two-minute walkthrough

See `docs/walkthrough.md`.

## 18. Security checklist

- [x] Server validates every field independently of the browser
- [x] Resume URL parsed; only http / https accepted
- [x] Unknown body fields ignored (no mass assignment)
- [x] Parameterised SQL everywhere
- [x] UNIQUE constraint prevents duplicate applications, even under simultaneous requests
- [x] Helmet headers and a strict CSP with no inline code
- [x] Rate limiting with 429 on applications and on the API
- [x] 10 KB body limit and JSON-only bodies
- [x] CORS closed by default
- [x] Generic 500 messages; no stack traces, SQL or paths in responses
- [x] No personal data in logs
- [x] `.env` ignored, `.env.example` placeholders only
- [x] Existing data is never reset on startup
- [ ] Rate limiting verified behind your real production proxy (do after deploying)
- [ ] Manual browser and accessibility checks in section 14
