# Test report

Everything below comes from a real run of `npm test` (Node's built-in test runner, `node --test`).
Nothing here is estimated.

## Result of the last run

Environment: Node.js v22.22.2, Linux sandbox, fresh `npm install`.

| Metric | Count |
|--------|-------|
| Test files | 5 (`api`, `persistence`, `applications`, `security`, `frontend`) |
| Suites | 22 |
| Tests | 137 |
| Passed | 137 |
| Failed | 0 |
| Skipped / cancelled | 0 / 0 |

Breakdown by file:

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/api.test.js` | 74 | Task 2: health, seed records INT-101 to INT-105, pagination, search, filters, CRUD, response envelope. Only change: the application payload now includes `resume_url`. |
| `tests/persistence.test.js` | 1 | Data survives a server restart. Unchanged. |
| `tests/applications.test.js` | 28 | Task 3: validation, unsafe URLs, duplicates (including 8 simultaneous requests), SQL-injection text, database failure returns a generic 500, malformed / oversized / wrong content type. |
| `tests/security.test.js` | 16 | Task 3: security headers and CSP, 429 rate limiting, CORS, safe errors, migration of a Task 2 database. |
| `tests/frontend.test.js` | 18 | Task 3: the real `index.html` and `app.js` run in jsdom against the real API: loading, success, empty, error, retry, validation, duplicate, 429, 500, double-submit, focus. |

## Do the new tests detect problems?

To check that the tests are not vacuous, five deliberate breakages were applied one at a time and the suite was run each time.
Every one was caught (and the code was restored afterwards):

| Deliberate breakage | Result |
|---------------------|--------|
| Accept any URL scheme for the resume link | 1 test failed |
| Remove the application rate limiter | 4 tests failed |
| Remove Helmet | 3 tests failed |
| Retry button does nothing | 1 test failed |
| Error handler returns the raw error message | 1 test failed |

## What is NOT covered by automated tests

- Real browser layout at 360px, 768px and desktop (jsdom has no layout engine).
- Colour contrast and screen-reader behaviour.
- Real `<dialog>` behaviour (jsdom lacks it; the test supplies a small stand-in).
- A run on Windows or Node.js 24. The code uses only built-in modules and pure-JavaScript packages, but this report only covers the run above.
- The deployed Render service (it has not been redeployed with Task 3 from this environment).

See the manual checklist in the README.
