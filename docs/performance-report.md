# Performance report

All numbers below were **measured** with the tools in `audit/` and are stored as raw data in `docs/evidence/`. Nothing is estimated or typed in from memory.

## 1. Read this first: what these numbers are, and are not

- They were measured **on `localhost` inside a shared cloud sandbox**, with headless Chromium 153 and Lighthouse 13.5.0, using Lighthouse's standard simulated throttling (mobile preset = slow 4G and a slowed CPU; desktop preset = no throttling).
- They are **not** measurements of the live Render website. Render Free adds network distance, and the free service can take **about a minute to wake up** after being idle. That cold start is not in these numbers. **Run Lighthouse against your live URL yourself** (section 6) and record that result separately.
- The sandbox's speed varies a lot from minute to minute. The same code scored 54 to 100 across runs. Because of that I ran each build **6 times per device, in the order Task 4, Task 3, Task 3, Task 4**, so that drift affects both builds equally, and I show **every run**, not just the best.
- Lighthouse scores near 100 are a ceiling: both builds are small and fast, so differences here are modest. The clearest real improvements are layout stability and download size.

## 2. Headline comparison: Task 3 build vs Task 4 build

Medians of 6 runs each (all runs are listed in section 3).

| Metric | Task 3 (before) | Task 4 (after) |
|--------|-----------------|----------------|
| Lighthouse performance, mobile | 96.5 | **100** |
| Lighthouse performance, desktop | 97.5 | **99** |
| Lighthouse accessibility / best practices / SEO (mobile and desktop) | 100 / 100 / 100 | 100 / 100 / 100 |
| Cumulative Layout Shift, mobile | 0.075 | **0** |
| Cumulative Layout Shift, desktop | 0.045 | **0** |
| First Contentful Paint, mobile | 1,157 ms | 1,020 ms |
| Largest Contentful Paint, mobile | 1,469 ms | 1,346 ms |
| Total Blocking Time, mobile | 34 ms | 43 ms |
| Total download for first visit (cold cache, 6 requests both builds) | 38,299 bytes | **19,932 bytes (-48%)** |

Reading it honestly:

- **Layout shift is the clear win.** Task 3 had a layout shift in 4 of 6 mobile runs (up to 0.12, which is "needs improvement" territory above 0.1) and in 5 of 6 desktop runs. Task 4 had **0 in all 12 runs**. Cause and fix: Task 3's loading spinner was replaced by taller card content, so the page jumped. Task 4 shows placeholder cards of matching size and reserves the results area's height.
- **Download size nearly halved** because responses are now compressed (Brotli or gzip, whichever the browser asks for), not because the files got smaller. The raw files actually grew (see section 4) because the page is a fuller landing page now.
- **FCP and LCP improved by about 10%**, but with this much run-to-run variation I would not call that proven. **Total Blocking Time is noise-level** in both builds (the difference of 9 ms is smaller than the spread).

## 3. Every run

Each list shows the 6 runs of that build in the order they were executed. TBT is Total Blocking Time; CLS is layout shift.

**Mobile preset**

| Build | Performance score per run | CLS per run | TBT (ms) per run | LCP (ms) per run |
|-------|--------------------------|-------------|------------------|------------------|
| Task 4 | 98, 100, 100, 100, 98, 100 | 0, 0, 0, 0, 0, 0 | 44, 54, 41, 0, 158, 0 | 1372, 1387, 1025, 1390, 1319, 986 |
| Task 3 | 70, 96, 100, 97, 54, 100 | 0.12, 0.12, 0.03, 0, 0.12, 0 | 720, 0, 0, 67, 7836, 0 | 1844, 1038, 1175, 1483, 1885, 1455 |

**Desktop preset**

| Build | Performance score per run | CLS per run | TBT (ms) per run | LCP (ms) per run |
|-------|--------------------------|-------------|------------------|------------------|
| Task 4 | 99, 96, 99, 100, 100, 98 | 0, 0, 0, 0, 0, 0 | 0, 0, 0, 0, 0, 0 | 509, 526, 486, 311, 579, 502 |
| Task 3 | 99, 96, 78, 100, 59, 99 | 0, 0.045, 0.045, 0.056, 0.056, 0.045 | 5, 94, 357, 0, 1669, 1 | 446, 474, 585, 399, 748, 444 |

The very low Task 3 scores (54, 59, 70, 78) are caused by single runs where the sandbox CPU stalled (TBT of 7,836 ms and 1,669 ms), not by anything in the page. They are included because leaving them out would be selective. Task 4's worst TBT was 158 ms. With only 6 runs per build, I do not claim that one build copes better with CPU stalls.

**An earlier session, disclosed on purpose.** A first full-audit run of the **same final Task 4 code**, taken while the sandbox was heavily loaded, scored mobile 64 / 67 / 72 (TBT 1,207-2,122 ms) and desktop 79 / 87 / 98. It is saved unchanged in `docs/evidence/audit-results.json`. This is the reason the comparison above was re-done as a controlled A/B. It also shows that **a single Lighthouse number from one machine is weak evidence**; run it 3+ times and report the range.

Raw data: `docs/evidence/ab/*.json` (the 4 A/B sessions) and `docs/evidence/ab-summary.json` (combined). Accessibility, best-practices and SEO scores were 100 in all 24 runs of both builds.

## 4. What the browser downloads on first visit (cold cache, measured with Chrome DevTools Protocol)

| File | Task 3 | Task 4 | Raw size now |
|------|--------|--------|--------------|
| `/` (HTML) | 7,610 B (uncompressed) | 4,021 B (Brotli) | 11,120 B |
| `/styles.css` | 8,218 B | 4,647 B (Brotli) | 12,754 B |
| `/app.js` | 17,998 B | 7,332 B (Brotli) | 21,639 B |
| `/config.js` | 879 B | 954 B | - |
| Filter-list request | 1,798 B (`/api/internships?limit=100`: downloads every internship just to build the Domain drop-down) | 1,082 B (`/api/domains`: names only) | - |
| First page of results | 1,796 B | 1,896 B | - |
| **Total** | **38,299 B** | **19,932 B** | |

Both builds make **6 requests** on first load. Browsers may also request the new `favicon.svg` (233 B); it was not counted in the table.

## 5. What was changed for performance, and whether it was measured

| Change | Measured? |
|--------|-----------|
| Placeholder (skeleton) cards and a reserved results height, to stop layout shift | **Yes**: CLS 0.075 -> 0 (mobile median), 0.045 -> 0 (desktop) |
| Response compression (`compression` middleware: Brotli/gzip) | **Yes**: 38,299 -> 19,932 bytes; also covered by a test |
| New `/api/domains` endpoint replacing a "download everything" call used only for the filter list | **Yes** (bytes: 1,798 -> 1,082); also tested that no `limit=100` call is made |
| ETag + `Cache-Control: no-cache` on GET API responses (browser re-checks, server answers 304 with no body) | **Tested** (304 test). Not visible in Lighthouse, which loads once |
| Static files cached for 5 minutes in production (`STATIC_MAX_AGE_SECONDS`) | Header **tested**; benefit not measured (Lighthouse's first-visit test cannot show it) |
| Search waits 300 ms after typing stops, so one request is sent instead of one per key | **Tested** (1 request for 3 keystrokes) |
| A newer search cancels the older request still in flight (`AbortController`) | **Tested** (older request is aborted). Benefit not measured; it matters on slow connections |
| One DOM update per page of cards (`DocumentFragment`) instead of one per card | **Not measured**: with 6 cards per page the difference is far below what any tool here can detect |
| Health check no longer counted by the rate limiter and no longer logged at info level | Design change; tested |
| No new front-end dependencies; no front-end framework | n/a |

Not changed on purpose: files are not fingerprinted, so they cannot safely be cached for long; Lighthouse flags this as the "efficient cache lifetimes" insight (see below).

## 6. Lighthouse items still flagged (they do not lower the score)

In all 12 Task 4 runs of the A/B test, Lighthouse listed these four items as below full marks, even where the category score was 100. (Other items appeared only in some runs and reflect machine noise: Speed Index in 8 runs, Max Potential FID in 6, Forced reflow in 3, Total Blocking Time in 1.)

- **Use efficient cache lifetimes**: static files are cached for 5 minutes, not a year, because file names do not change when the content does. A build step with hashed file names would fix this; it was left out to avoid adding tooling.
- **Render-blocking requests**: `styles.css` blocks first paint. It is small (4.6 KB compressed) and needed for the first paint.
- **Network dependency tree**: HTML -> `app.js` -> API requests happen one after another. Possible improvement: preload the first API request. Not done.
- **Main-thread work breakdown**: small, mostly the browser's own style and layout work.

## 7. API and database

- Search, filter and pagination run in SQLite. With 5 seeded rows, response time is a few milliseconds. Single timing samples seen from the browser were 6-28 ms; these are too few and too noisy to compare between builds, so **no API speed-up is claimed**.
- Search uses `LIKE '%text%'` plus `json_each` over skills. That scans every row, which is fine for hundreds of rows but would need an index or SQLite full-text search for tens of thousands. **No load test was run**, so no throughput claim is made.
- The database is opened once and statements are prepared per request, which is adequate for this size.

## 8. How to measure it yourself

**Live site (most important for submission).** In Chrome: open your Render URL (wake it first by visiting it, wait for it to load), press `F12`, open the **Lighthouse** tab, choose Mobile, tick Performance, Accessibility, Best practices and SEO, and press **Analyze page load**. Repeat 3 times and record the range. Use an Incognito window with extensions off for fair results. Paste the numbers into the table below.

| Date | URL | Device | Perf | A11y | Best practices | SEO | Notes |
|------|-----|--------|------|------|----------------|-----|-------|
| _(fill in after you run it)_ | | | | | | | |

**Repeat my local measurements.** In one PowerShell window run `npm start`. In a second:

```powershell
cd audit
npm install
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node run.mjs
```

This writes fresh results to `docs/evidence/audit-results.json` (it submits a few test applications, so use a throw-away database).
