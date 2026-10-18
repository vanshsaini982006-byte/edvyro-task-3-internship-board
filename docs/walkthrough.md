# Two-minute walkthrough script

Roughly 10 seconds per step. Have the server running (`npm start`) and a terminal plus a browser ready. Use Git Bash or `curl.exe` on Windows.

| # | Time | Show | Say |
|---|------|------|-----|
| 1 | 0:00 | Project folder in the editor | "Routes, controllers, middleware, database and tests are in separate folders." |
| 2 | 0:10 | `database/schema.sql` | "Two tables: `internships` and `applications`. Skills are JSON text. Applications have a UNIQUE rule on internship and email." |
| 3 | 0:20 | `database/seed.sql` | "The five seed records `INT-101` to `INT-105`, inserted with `INSERT OR IGNORE`." |
| 4 | 0:30 | `curl http://localhost:3000/api/internships` | "List endpoint with the success envelope and pagination block." |
| 5 | 0:40 | `?page=1&limit=2`, `?search=frontend`, `?domain=UI/UX`, `?mode=Remote` | "Pagination, search and both filters. They also combine." |
| 6 | 0:55 | `GET /api/internships/INT-101`, then `/INVALID` | "Detail returns 200. A missing ID returns 404 with the error envelope." |
| 7 | 1:05 | `POST /api/internships` (INT-106), then `PUT` | "Create returns 201, update returns 200. The ID cannot be changed." |
| 8 | 1:20 | `DELETE /api/internships/INT-106` | "Delete returns 200." |
| 9 | 1:25 | `POST /api/applications`, then repeat it | "First is 201. The same email again is 409 `DUPLICATE_APPLICATION`." |
| 10 | 1:40 | A POST with a missing title and invalid mode | "400 with per-field messages. Same error shape everywhere." |
| 11 | 1:50 | Stop the server (Ctrl+C), `npm start`, fetch `INT-101` / the created record | "Data is still there: it lives in the SQLite file, not in memory." |
| 12 | 2:00 | (optional) Browser at `http://localhost:3000` | "The front end uses the same API: search, filters, details dialog, apply form." |

## Task 3 additions (replace steps 9 and 12 with these for a Task 3 demo)

| # | Show | Say |
|---|------|-----|
| A | Browser: search `sql`, filter Hybrid, then search `zzz` and press Clear | "Cards come from the API. Empty state is helpful." |
| B | Stop the server, press Search, then start it and press Try again | "Friendly error and a working retry." |
| C | Open an internship, submit the form empty | "Field-specific messages, focus goes to the first error." |
| D | Enter resume `javascript:alert(1)` | "Blocked in the browser, and the server rejects it too (show the curl 400)." |
| E | Submit a valid application, then the same email again | "201 and a confirmation, then a clear duplicate message. The UNIQUE constraint backs this up." |
| F | `npm test` | "137 tests, including rate limiting and a jsdom run of the real frontend." |
