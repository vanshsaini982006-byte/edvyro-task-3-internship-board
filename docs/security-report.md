# Security report

Scope: the Internship Board application (Express API + static front end + SQLite) as of Task 4.
Evidence labels: **[A]** automated test in `npm test`, **[S]** a command or code search run during the Task 4 review, **[M]** a manual step you should still do, **[L]** a known limitation.

This is a self-review of a small student project. It is **not** a penetration test and not an independent audit.

## 1. Summary

| Area | Status |
|------|--------|
| Known-vulnerable dependencies (`npm audit`) | 0 reported **[S]** (re-run before submitting) |
| Secrets in the repository | None found; `.env` and `*.db` are git-ignored; `.env.example` has placeholders only **[S]** |
| Unsafe HTML rendering | No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval` anywhere in `public/app.js` **[S]**; page uses no inline script or style, which a test enforces **[A]** |
| SQL injection | All values pass as `?` parameters. The only template-built SQL (the `WHERE` clause of the list query) is assembled from fixed text and placeholders **[S]**; injection strings in search, domain, mode and application fields are tested **[A]** |
| Overall | No open high-severity finding that I know of. Residual risks are listed in section 5. |

## 2. Controls, where they live, and the evidence

| Control | Implementation | Evidence |
|---------|----------------|----------|
| Security headers | Helmet 8 plus `Permissions-Policy` (`src/middleware/security.js`). Sent: CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, COOP, CORP, `X-Powered-By` removed | **[A]** `tests/security.test.js` (headers on `/` and `/api/health`); real response headers captured with `curl -I` **[S]** |
| Content Security Policy | `default-src 'self'`, scripts and styles from the same origin only, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; **no** `unsafe-inline`, `unsafe-eval` or `*`. `upgrade-insecure-requests` is added only in production | **[A]** CSP content test and "page has no inline code" test. The full user journey (search, filter, dialog, apply, duplicate) ran in real Chromium with the policy active and worked **[S]**; Lighthouse's "no browser errors in the console" check passed in its runs **[S]** |
| CORS | Closed by default. `CORS_ORIGIN` takes exact origins; anything else gets no CORS headers | **[A]** default-closed, allowed origin, denied origin and preflight tests |
| API rate limit | 300 requests / 15 min / IP (configurable) | **[A]** returns 429 `RATE_LIMITED` with `Retry-After` |
| Application rate limit | 10 submissions / 15 min / IP (configurable), applied before validation | **[A]** blocked requests are not processed or saved; browsing still works |
| Health check exempt from limits | `/api/health` is mounted before the limiter so a host's health pings cannot be blocked and trigger restarts | **[A]** 6 health calls succeed with the API limit set to 2 |
| Server-side validation | Every field re-validated on the server (`src/middleware/validation.js`); unknown fields ignored (no mass assignment) | **[A]** `tests/applications.test.js` (28 tests) |
| Safe URL validation | `new URL()` parse; only `http:`/`https:`; no spaces, control characters or embedded credentials; max 2048. `javascript:`, `data:`, `file:`, `ftp:`, `vbscript:`, `blob:` rejected. Resume links are never fetched by the server and never rendered as clickable links | **[A]** |
| Parameterised SQL | `node:sqlite` prepared statements with `?` | **[A]** injection tests; controller-source check; **[S]** grep |
| Duplicate prevention | `UNIQUE (internship_id, applicant_email)` with case-insensitive email, plus a friendly pre-check. Backed by the database, so it holds under simultaneous requests | **[A]** includes 8 simultaneous identical requests -> exactly one 201 |
| Body limits | JSON bodies over 10 KB refused; non-JSON bodies get 415; malformed JSON gets 400 without echoing the body | **[A]** |
| Safe errors | Unexpected errors return a generic 500. No stack, SQL, path or message from the underlying error reaches the client | **[A]** database failure tests on both the API and the browser |
| Safe logging | Method, path (no query string), route pattern, status, milliseconds, request ID. Never names, emails, resume links, cover letters, request bodies, IPs or headers. Control characters in paths are neutralised so log lines cannot be forged | **[A]** `tests/observability.test.js`, including a test that submits distinctive personal data through success, duplicate, validation-error, bad-JSON and database-failure paths and searches every log line for it |
| Caching | `POST` responses `no-store`; GET API responses `no-cache` (revalidate); static files 5 min in production | **[A]** |
| Secrets handling | No secrets are needed by the app. Settings come from environment variables | **[S]** |
| Dependencies | Runtime: `express`, `helmet`, `express-rate-limit`, `cors`, `compression`. Dev only: `jsdom`. The audit tools (Lighthouse etc.) live in a separate `audit/` folder and are not app dependencies | **[S]** |

## 3. Changes made during the Task 4 security review

| Finding | Change |
|---------|--------|
| The health check sat behind the rate limiter. A hosting platform polling it from one address would eventually receive 429 and could mark a healthy service as down | Health check now mounted before the limiter (and now also checks the database) |
| The application controller wrote its log line with `console.log` outside the structured logger | Uses the structured logger with a request ID; test updated |
| Error logging printed the full stack | Logs only name, code, a trimmed message and the first lines of the stack, with control characters removed, and never the request body |
| No `Permissions-Policy` header | Added, disabling camera, microphone, geolocation, payment and USB |
| API responses had no explicit cache policy | `no-store` for writes, `no-cache` + ETag for reads |
| Requests could not be traced in logs | `X-Request-Id` header (safe incoming IDs are kept, anything else replaced) |

## 4. Review checklist from the Task 4 brief

| Item | Result |
|------|--------|
| Helmet headers | Done **[A]** |
| Strict CSP | Done **[A]** |
| CORS configuration | Done **[A]** |
| API rate limiting | Done **[A]** |
| Application submission rate limiting | Done **[A]** |
| Server-side validation | Done **[A]** |
| Safe URL validation | Done **[A]** |
| SQL injection prevention / parameterised queries | Done **[A]** **[S]** |
| Duplicate application prevention | Done **[A]** |
| Request body size limits | Done **[A]** |
| Safe error handling | Done **[A]** |
| Environment variables documented | Done (`.env.example`) |
| No committed secrets | None found **[S]**. **[M]** run `git status` and `git log -p -- .env` before pushing |
| No unsafe HTML rendering | Done **[A]** **[S]** |

## 5. Known limitations and residual risks

- **[L] Rate limit counters are in memory.** They reset when the service restarts and are per instance. On Render Free this means they also reset when the service wakes from idle. Strict global limits would need a shared store such as Redis, which is a paid or extra service and was not added.
- **[L] `TRUST_PROXY` must match the real number of proxies.** Set it to `1` on Render. If it is wrong, every visitor may share one limit, or clients could spoof their IP.
- **[L] No CAPTCHA and no email verification.** A bot that rotates IP addresses, or someone using a fake email address, can still submit applications within the limits.
- **[L] Resume links are stored, not checked.** The server never opens them, but a reviewer who clicks a stored link is trusting it.
- **[L] Email normalisation is simple** (trim + lower-case). `a.b@gmail.com` and `ab@gmail.com` count as different people.
- **[L] There is no authentication.** The existing Task 2 write endpoints for internships (`POST`/`PUT`/`DELETE /api/internships`) have never required login, so **anyone who knows the API can change or delete listings**. This was left unchanged on purpose (the brief says not to add authentication unless required, and Task 2 tests depend on these endpoints), but it is the most important thing to fix before any real use, for example with an admin key or login.
- **[L] SQLite is a single-file database** designed for one server instance.
- **[L] Render Free resets the database** (see the README). Do not collect real personal data on this deployment.
- **[M] Not done:** an external penetration test, a dependency review beyond `npm audit`, and a check of the Render dashboard configuration. I could not see your Render service.
