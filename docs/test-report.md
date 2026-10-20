# Test report

Everything here comes from real runs. "Automated" means it is repeated by `npm test`. "Real-browser" means the script in `audit/` was run in headless Chromium. "Manual / not done" is stated plainly.

## 1. Automated test suite (`npm test`)

Last run: Node.js v22.22.2, Linux sandbox, fresh `npm install`, built-in `node --test`.

| Metric | Result |
|--------|--------|
| Test files | 7 |
| Suites | 32 |
| Tests | **215** |
| Passed | **215** |
| Failed / skipped / cancelled | 0 / 0 / 0 |
| Duration | about 9 seconds |
| `npm audit` | 0 vulnerabilities |

Not run: Windows, Node.js 24, or the deployed Render service. The app uses only built-in Node modules and pure-JavaScript packages, but I have not run the suite on those.

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/api.test.js` | 74 | Task 2 contract: seed records INT-101 to INT-105, pagination, search, filters, CRUD, error envelope, health |
| `tests/persistence.test.js` | 1 | Data survives a server restart |
| `tests/applications.test.js` | 28 | Task 3: validation, unsafe URLs, duplicates (including 8 simultaneous requests), SQL-injection text, safe 500, malformed / oversized / wrong content type |
| `tests/security.test.js` | 18 | Headers and CSP, 429 rate limits, CORS, safe errors, SQL injection through the list endpoint, migration of a Task 2 database |
| `tests/observability.test.js` | 16 | Request logs, no personal data in any log line, request IDs, log-forging protection, health check and its 503, ETag/304, compression, static caching, `/api/domains` |
| `tests/frontend.test.js` | 28 | The real `index.html` and `app.js` in jsdom against the real API: loading, empty, error, retry, validation, duplicate, 429, 500, menu, debounce, request cancellation, page address, pagination focus, confirmation |
| `tests/design.test.js` | 50 | Colour contrast calculated from `styles.css` (32 pairs), page structure and ARIA references, small-screen CSS rules |

### Regression status for earlier tasks

- All 75 tests that existed at the start of Task 3 and all 137 at the start of Task 4 are still present and passing.
- Tests I **changed** (not deleted), and why:
  - `api.test.js`: the application payload includes `resume_url` (required since Task 3); the health test now checks `message` and the envelope exactly as before and also the new `database`, `uptime_seconds` and `version` fields.
  - `security.test.js`: the "general limit returns 429" test now calls `/api/domains`, because `/api/health` is deliberately exempt from the limiter.
  - `frontend.test.js`: the success test now expects the confirmation panel instead of a status line.

### Do the tests detect problems?

Seven deliberate breakages were applied one at a time during Task 4 and the suite was run each time. All were caught, and the code was restored afterwards.

| Deliberate breakage | Tests that failed |
|---------------------|-------------------|
| Applicant email added to a log line | 2 |
| Health check placed behind the rate limiter | 1 |
| Muted text colour made too light | 4 |
| Older search request no longer cancelled | 1 |
| Compression removed | 1 |
| Raw request body added to the error log | 1 |
| Skip-link target removed | 1 |

(Five similar checks were also done in Task 3.)

## 2. Real-browser checks (not part of `npm test`)

Run with `audit/run.mjs` in headless Chromium 153. Raw data: `docs/evidence/audit-results.json`, `layout-320.json`, `ab/*.json`; screenshots: `docs/evidence/screenshots/`.

| Check | Result |
|-------|--------|
| No sideways scrolling at 320, 360, 375, 768, 1280 px | Pass |
| No control smaller than 44 px | Pass |
| Details dialog fits at 320 to 768 px | Pass |
| axe-core 4.14.0, 6 page states | 0 violations; colour contrast "needs review" in dialog states |
| Keyboard flow (Tab order, focus rings, Enter, Esc, focus return) | Pass |
| Full journey in a real browser: search, filter, empty state, offline error then Retry, validation, success, duplicate | Pass |
| Lighthouse (24 runs) | See `docs/performance-report.md` |

## 3. Manual checks you still need to do

- [ ] Screen reader (NVDA) walkthrough
- [ ] A real phone
- [ ] Browser zoom 200% and 400%
- [ ] Lighthouse on the live Render URL
- [ ] `npm test` on your own Windows computer, and paste the result below

Your own run: `____ tests, ____ passed, ____ failed` on ______ (date), Node ______.

## 4. Limits of these tests

- jsdom has no layout engine and no real `<dialog>`; the frontend tests supply a small stand-in for the dialog and rely on the real-browser audit for layout.
- The rate-limit, health and database-failure tests use a temporary database and mocks of the database call on purpose.
- Tests on timing (response time in logs) only check that a sensible number is logged.
