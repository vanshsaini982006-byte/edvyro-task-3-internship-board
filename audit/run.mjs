// Real-browser audit for the Internship Board.
//
//   Terminal 1 (project folder):   npm start
//   Terminal 2:                    cd audit && npm install && node run.mjs
//
// Optional: ONLY=lighthouse,network  (run just some sections)   OUT=other.json   BASE_URL=http://...
//
// Uses Google Chrome / Chromium. Set CHROME_PATH to your chrome.exe, for example
//   $env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
// If CHROME_PATH is not set, a bundled Chromium (@sparticuz/chromium, Linux only) is tried.
//
// Writes docs/evidence/audit-results.json, Lighthouse summaries and screenshots.
// Every number in the reports comes from this file; nothing is typed in by hand.
// WARNING: it submits a few test applications, so run it against a throw-away database
// (for example set DATABASE_PATH to a temp file before `npm start`).

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

const require = createRequire(import.meta.url);
const axeSource = (await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8'));
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'docs', 'evidence');
const shotDir = path.join(outDir, 'screenshots');
await fs.mkdir(shotDir, { recursive: true });

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const LIGHTHOUSE_RUNS = Number(process.env.LIGHTHOUSE_RUNS || 3);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (name) => !only || only.has(name);
const OUT_FILE = process.env.OUT || 'audit-results.json';
const results = { generatedAt: new Date().toISOString(), baseUrl: BASE };

async function chromePath() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH, args: [] };
  try {
    const { default: chromium } = await import('@sparticuz/chromium');
    return { executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'] };
  } catch {
    throw new Error('No browser found. Set CHROME_PATH to your Chrome/Chromium executable.');
  }
}
const launch = await chromePath();
const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: 'shell' });
results.browser = await browser.version();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pct = (score) => (score == null ? null : Math.round(score * 100));

async function newPage(width, height = 800) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  return page;
}
async function waitForCards(page) {
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length > 0, { timeout: 10000 });
}
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(shotDir, name), fullPage });

// ---------------------------------------------------------------- 1. Lighthouse
async function runLighthouse() {
  const out = {};
  for (const preset of ['mobile', 'desktop']) {
    const runs = [];
    for (let i = 0; i < LIGHTHOUSE_RUNS; i++) {
      const port = new URL(browser.wsEndpoint()).port;
      const flags = { port: Number(port), output: ['json', 'html'], logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] };
      const config = preset === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
      const r = await lighthouse(`${BASE}/`, flags, config);
      const lhr = r.lhr;
      const a = lhr.audits;
      runs.push({
        scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, pct(v.score)])),
        rawScores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v.score])),
        metrics: {
          fcpMs: Math.round(a['first-contentful-paint'].numericValue),
          lcpMs: Math.round(a['largest-contentful-paint'].numericValue),
          tbtMs: Math.round(a['total-blocking-time'].numericValue),
          cls: Number(a['cumulative-layout-shift'].numericValue.toFixed(3)),
          speedIndexMs: Math.round(a['speed-index'].numericValue),
          interactiveMs: Math.round(a['interactive'].numericValue),
        },
        totalTransferBytes: Math.round(a['total-byte-weight'].numericValue),
        requests: a['network-requests'].details.items.length,
        failedAudits: Object.values(a).filter((x) => x.score !== null && x.score < 1 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable')
          .map((x) => `${x.id}: ${x.title}`),
        lighthouseVersion: lhr.lighthouseVersion,
        userAgent: lhr.environment.hostUserAgent,
      });
      if (i === 0) if (!process.env.NO_HTML) await fs.writeFile(path.join(outDir, `lighthouse-${preset}.html`), r.report[1]);
    }
    const pick = (fn) => median(runs.map(fn));
    out[preset] = {
      runs,
      median: {
        performance: pick((r) => r.scores.performance), accessibility: pick((r) => r.scores.accessibility),
        bestPractices: pick((r) => r.scores['best-practices']), seo: pick((r) => r.scores.seo),
        fcpMs: pick((r) => r.metrics.fcpMs), lcpMs: pick((r) => r.metrics.lcpMs), tbtMs: pick((r) => r.metrics.tbtMs),
        cls: pick((r) => r.metrics.cls), speedIndexMs: pick((r) => r.metrics.speedIndexMs),
      },
    };
    console.log('lighthouse', preset, JSON.stringify(out[preset].median));
  }
  return out;
}

// ---------------------------------------------------------------- 2. Responsive layout
async function layoutAt(width) {
  const page = await newPage(width);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitForCards(page);
  const info = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      const hidden = r.width === 0 && r.height === 0;
      return !hidden && (r.right > vw + 0.5 || r.left < -0.5) && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 8).map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className}`);
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const small = [...document.querySelectorAll('button, select, input, textarea, nav a, .brand, .btn')]
      .filter(visible)
      .map((el) => { const r = el.getBoundingClientRect(); return { el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.h < 44 || x.w < 44);
    const nav = document.getElementById('site-nav');
    const toggle = document.getElementById('nav-toggle');
    const fontSizes = [...document.querySelectorAll('p, li, label, a, button, dd, dt')].filter(visible).map((el) => parseFloat(getComputedStyle(el).fontSize));
    return {
      viewportWidth: vw, documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > vw,
      elementsOutsideViewport: offenders,
      belowMinimumTapSize: small,
      navVisible: visible(nav), menuButtonVisible: visible(toggle),
      smallestFontPx: Math.min(...fontSizes),
      cardCount: document.querySelectorAll('#card-list > li').length,
      cardColumns: new Set([...document.querySelectorAll('#card-list > li')].map((el) => Math.round(el.getBoundingClientRect().left))).size,
    };
  });
  await shot(page, `home-${width}.png`);
  await shot(page, `home-${width}-top.png`, false);
  await page.close();
  return info;
}

async function dialogAt(width) {
  const page = await newPage(width, 740);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitForCards(page);
  await page.click('#card-list button');
  await page.waitForSelector('#dialog-content:not([hidden])');
  const measure = () => page.evaluate(() => {
    const d = document.getElementById('details-dialog');
    const inner = d.querySelector('.dialog-inner');
    const r = d.getBoundingClientRect();
    return { dialogLeft: Math.round(r.left), dialogRight: Math.round(r.right), viewport: document.documentElement.clientWidth,
      dialogHeight: Math.round(r.height), viewportHeight: window.innerHeight,
      innerHorizontalOverflow: inner.scrollWidth > inner.clientWidth, pageHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollsInside: inner.scrollHeight > inner.clientHeight, bodyScrollLocked: getComputedStyle(document.body).overflow === 'hidden' };
  });
  const open = await measure();
  await shot(page, `dialog-${width}.png`, false);
  await page.click('#apply-submit'); // empty submit -> validation messages
  const errors = await measure();
  await shot(page, `dialog-errors-${width}.png`, false);
  await page.evaluate(() => document.querySelector('#details-dialog .dialog-inner').scrollTo(0, 99999));
  await shot(page, `dialog-errors-bottom-${width}.png`, false);
  await page.close();
  return { open, withErrors: errors };
}

// ---------------------------------------------------------------- 3. axe-core
async function axeScan(page, label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
  return {
    state: label, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
    passes: r.passes.length, incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })), axeVersion: r.testEngine.version,
  };
}
async function axeAll() {
  const out = [];
  for (const width of [360, 1280]) {
    const page = await newPage(width, 800);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await waitForCards(page);
    out.push({ width, ...(await axeScan(page, 'home')) });
    await page.click('#card-list button');
    await page.waitForSelector('#dialog-content:not([hidden])');
    out.push({ width, ...(await axeScan(page, 'dialog open')) });
    await page.click('#apply-submit');
    out.push({ width, ...(await axeScan(page, 'dialog with validation errors')) });
    await page.close();
  }
  return out;
}

// ---------------------------------------------------------------- 4. Keyboard and focus
async function keyboard() {
  const page = await newPage(1280, 900);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitForCards(page);
  const describe = () => page.evaluate(() => {
    const el = document.activeElement; const s = getComputedStyle(el);
    const label = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.id || el.tagName;
    return { tag: el.tagName.toLowerCase(), label, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth), outlineColor: s.outlineColor, boxShadow: s.boxShadow !== 'none' };
  });
  const order = [];
  for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); order.push(await describe()); }
  const focusVisibleOnAll = order.every((x) => (x.outlineStyle !== 'none' && x.outlineWidth >= 2) || x.boxShadow);

  // open the dialog with the keyboard
  await page.focus('#card-list button');
  const triggerLabel = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#dialog-content:not([hidden])');
  const dialogOpen = await page.evaluate(() => document.getElementById('details-dialog').open);
  const insideAfterOpen = await page.evaluate(() => document.getElementById('details-dialog').contains(document.activeElement));
  // A native modal dialog makes everything behind it inert, but it lets Tab reach the browser's own
  // controls (address bar), where document.activeElement becomes <body>. So the real question is:
  // does focus EVER land on page content behind the dialog? (It must not.)
  let reachedBackground = false; let leftToBrowserUi = 0; const focusedInDialog = [];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const el = document.activeElement; const dialog = document.getElementById('details-dialog');
      if (dialog.contains(el)) return 'dialog';
      if (el === document.body || el === document.documentElement) return 'browser-ui';
      return 'background';
    });
    if (where === 'background') reachedBackground = true;
    if (where === 'browser-ui') leftToBrowserUi++;
    if (i < 8) focusedInDialog.push(await describe());
  }
  const trapped = !reachedBackground;
  // validation focus: submit empty with Enter inside the form
  await page.focus('#apply-submit');
  await page.keyboard.press('Enter');
  const focusAfterInvalid = await page.evaluate(() => document.activeElement.id);
  const ariaInvalid = await page.evaluate(() => document.getElementById('applicant-name').getAttribute('aria-invalid'));
  const nameErrorText = await page.evaluate(() => document.getElementById('applicant-name-error').textContent);
  await page.keyboard.press('Escape');
  await sleep(150);
  const closedByEscape = await page.evaluate(() => !document.getElementById('details-dialog').open);
  const focusReturnedTo = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));

  // search + filter with keyboard only
  await page.focus('#search');
  await page.keyboard.type('sql', { delay: 20 });
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 2, { timeout: 5000 });
  const summary = await page.$eval('#result-summary', (el) => el.textContent);
  await page.close();
  return { tabOrderFirst16: order, focusVisibleOnAll, openedWithEnter: dialogOpen, focusMovedIntoDialog: insideAfterOpen, focusNeverReachedBackgroundIn24Tabs: trapped, tabsThatLeftTheDialogToBrowserUi: leftToBrowserUi,
    focusedFirstInDialog: focusedInDialog, focusAfterInvalidSubmit: focusAfterInvalid, nameAriaInvalid: ariaInvalid, nameErrorText,
    escapeClosedDialog: closedByEscape, focusReturnedToTrigger: focusReturnedTo === triggerLabel, triggerLabel, typingSearchResult: summary };
}

// ---------------------------------------------------------------- 5. End-to-end journey in a real browser
async function journey() {
  const page = await newPage(375, 812);
  const log = [];
  const stamp = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitForCards(page);
  log.push(['home loaded', await page.$$eval('#card-list > li', (n) => n.length) + ' cards']);

  // search + domain + mode filters
  await page.type('#search', 'sql');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 2);
  await page.select('#mode', 'Hybrid');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 1);
  log.push(['search "sql" + Hybrid', await page.$eval('#card-list h3', (e) => e.textContent)]);
  const urlAfterFilter = new URL(page.url()).search;
  await page.click('#clear-filters');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 5);

  // empty state
  await page.type('#search', 'zzzzqq');
  await page.waitForSelector('#state-empty:not([hidden])');
  log.push(['empty state shown', true]);
  await shot(page, 'state-empty-375.png', false);
  await page.click('#empty-clear');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 5);

  // error + retry (real offline mode)
  await page.setOfflineMode(true);
  await page.type('#search', 'frontend');
  await page.waitForSelector('#state-error:not([hidden])', { timeout: 8000 });
  const errorText = await page.$eval('#state-error-text', (e) => e.textContent);
  await shot(page, 'state-error-375.png', false);
  await page.setOfflineMode(false);
  await page.click('#retry-list');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 1, { timeout: 8000 });
  log.push(['offline error then Retry recovered', errorText]);
  await page.click('#clear-filters');
  await page.waitForFunction(() => document.querySelectorAll('#card-list > li').length === 5);

  // apply: validation, success, duplicate
  await page.click('#card-list button');
  await page.waitForSelector('#dialog-content:not([hidden])');
  await page.type('#applicant-name', 'Audit Tester');
  await page.type('#applicant-email', `audit-${stamp}@example.com`);
  await page.type('#resume-url', 'javascript:alert(1)');
  await page.click('#apply-submit');
  const unsafeUrlMessage = await page.$eval('#resume-url-error', (e) => e.textContent);
  await shot(page, 'form-validation-375.png', false);
  await page.$eval('#resume-url', (e) => { e.value = ''; });
  await page.type('#resume-url', 'https://example.com/audit-resume.pdf');
  await page.click('#apply-submit');
  await page.waitForSelector('#apply-confirmation:not([hidden])');
  const confirmation = await page.$eval('#apply-confirmation', (e) => e.innerText);
  const focusOnConfirmation = await page.evaluate(() => document.activeElement.id);
  await shot(page, 'confirmation-375.png', false);
  await page.click('#confirm-close');
  await sleep(100);

  await page.click('#card-list button');
  await page.waitForSelector('#dialog-content:not([hidden])');
  await page.type('#applicant-name', 'Audit Tester');
  await page.type('#applicant-email', `AUDIT-${stamp}@Example.com`);
  await page.type('#resume-url', 'https://example.com/audit-resume.pdf');
  await page.click('#apply-submit');
  await page.waitForFunction(() => document.getElementById('apply-error').textContent.length > 0);
  const duplicateMessage = await page.$eval('#apply-error', (e) => e.textContent);
  const valuesKept = await page.$eval('#applicant-name', (e) => e.value);
  await shot(page, 'duplicate-375.png', false);

  // direct API checks through the browser's own network stack: unsafe URL and headers
  const headers = await page.evaluate(async () => {
    const r = await fetch('/api/internships/INT-101');
    return { status: r.status, requestId: r.headers.get('x-request-id'), cacheControl: r.headers.get('cache-control') };
  });
  await page.close();
  return { log, urlAfterFilter, unsafeUrlMessage, confirmationText: confirmation.replace(/\s+/g, ' ').trim(), focusOnConfirmation, duplicateMessage, valuesKeptAfterDuplicate: valuesKept, headers };
}

// ---------------------------------------------------------------- 6. Network cost of loading the page
async function networkCost(width, label) {
  const page = await newPage(width, 800);
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  const sizes = new Map();
  client.on('Network.responseReceived', (e) => sizes.set(e.requestId, { url: e.response.url.replace(BASE, '') || '/', status: e.response.status, encoding: e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || 'none', type: e.type }));
  client.on('Network.loadingFinished', (e) => { const s = sizes.get(e.requestId); if (s) s.transferBytes = e.encodedDataLength; });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitForCards(page);
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd),
      api: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/')).map((e) => ({ url: e.name.replace(location.origin, ''), ms: Math.round(e.duration) })),
    };
  });
  const files = [...sizes.values()];
  await page.close();
  return { label, files, totalTransferBytes: files.reduce((n, f) => n + (f.transferBytes || 0), 0), requestCount: files.length, ...timing };
}

// ---------------------------------------------------------------- run everything
try {
  if (want('layout')) {
    results.layout = {};
    for (const w of (process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [320, 360, 375, 768, 1280])) results.layout[w] = await layoutAt(w);
    console.log('layout done');
    results.dialog = {};
    for (const w of (process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number).filter((x) => x <= 768) : [320, 360, 375, 768])) results.dialog[w] = await dialogAt(w);
    console.log('dialog done');
  }
  if (want('axe')) { results.axe = await axeAll(); console.log('axe done'); }
  if (want('keyboard')) { results.keyboard = await keyboard(); console.log('keyboard done'); }
  if (want('journey')) { results.journey = await journey(); console.log('journey done'); }
  if (want('network')) {
    results.network = [await networkCost(375, 'mobile viewport, cold cache'), await networkCost(1280, 'desktop viewport, cold cache')];
    console.log('network done');
  }
  if (want('lighthouse')) results.lighthouse = await runLighthouse();
  await fs.writeFile(path.join(outDir, OUT_FILE), JSON.stringify(results, null, 2));
  console.log(`Done. Results written to docs/evidence/${OUT_FILE}`);
} finally {
  await browser.close();
}
