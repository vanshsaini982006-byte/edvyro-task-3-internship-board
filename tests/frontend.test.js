'use strict';

// Front-end integration tests. The real public/index.html and public/app.js run inside jsdom
// (a simulated browser) and talk over HTTP to the real Express app and a throw-away SQLite file.
// Nothing about the API is faked except where a test deliberately breaks the network or the database.
// jsdom cannot check real layout, so 360px / contrast / screen-reader checks stay manual (see README).

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { makeTempDatabasePath, listen, close, fs } = require('./helpers');

const temp = makeTempDatabasePath('internship-frontend-test-');
process.env.DATABASE_PATH = temp.file;
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const database = require('../src/db');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');

const servers = [];
const windows = [];
let baseUrl;

async function startApp(env = {}) {
  const started = await listen(createApp(loadConfig({ NODE_ENV: 'test', ...env })));
  servers.push(started.server);
  return started.baseUrl;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await wait(10);
  }
  assert.fail(`Timed out waiting for: ${message}`);
}

// Opens the page like a browser would. `net` records every API call and lets a test break the network.
async function openPage(serverUrl = baseUrl) {
  const dom = new JSDOM(html, { url: `${serverUrl}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);

  // jsdom has no <dialog> behaviour yet: provide the small part the page uses.
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };

  const net = { calls: [], offline: false, gate: null };
  window.fetch = async (url, options = {}) => {
    net.calls.push({ method: options.method || 'GET', url: String(url) });
    if (net.gate) await net.gate;
    if (net.offline) throw new TypeError('Failed to fetch');
    return fetch(new URL(url, serverUrl), options);
  };

  const config = await (await fetch(`${serverUrl}/config.js`)).text(); // the real config.js from the server
  window.eval(config);
  window.eval(appJs);

  const $ = (id) => window.document.getElementById(id);
  return { window, document: window.document, $, net };
}

const cards = (page) => [...page.document.querySelectorAll('#card-list > li')];
const cardTitles = (page) => cards(page).map((li) => li.querySelector('h3').textContent);

async function openApplyForm(page, buttonLabel = 'View details for Frontend Intern') {
  await waitFor(() => cards(page).length > 0, 'cards to render');
  const button = [...page.document.querySelectorAll('#card-list button')].find((b) => b.getAttribute('aria-label') === buttonLabel);
  assert.ok(button, `button "${buttonLabel}" not found`);
  button.click();
  await waitFor(() => !page.$('dialog-content').hidden, 'details to load');
}

function fillForm(page, values) {
  const map = { name: 'applicant-name', email: 'applicant-email', resume: 'resume-url', letter: 'cover-letter' };
  for (const [key, value] of Object.entries(values)) page.$(map[key]).value = value;
}
const submit = (page) => page.$('apply-form').dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
const posts = (page) => page.net.calls.filter((c) => c.method === 'POST');

before(async () => { baseUrl = await startApp(); });
after(async () => {
  windows.forEach((w) => w.close());
  for (const server of servers) await close(server);
  database.closeDatabase();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe('Internship list uses the real API', () => {
  test('shows a loading state, then renders the records the API returned', async () => {
    const page = await openPage();
    // The very first thing after the script runs is the loading state.
    assert.equal(page.$('state-loading').hidden, false);
    assert.equal(page.$('card-list').hidden, true);
    await waitFor(() => cards(page).length === 5, 'five cards');
    assert.equal(page.$('state-loading').hidden, true);
    assert.deepEqual(cardTitles(page), ['Frontend Intern', 'API Engineering Intern', 'UI/UX Intern', 'Data Analyst Intern', 'Security Operations Intern']);
    assert.ok(page.net.calls.some((c) => c.url.startsWith('/api/internships?')), 'the page must call the real API');
    assert.match(page.$('result-summary').textContent, /Showing 1–5 of 5 internships/);
  });

  test('the cards come from the API, not from hardcoded data', async () => {
    const created = await fetch(`${baseUrl}/api/internships`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'INT-FE1', title: 'Temporary Frontend Test Role', domain: 'Testing', mode: 'Remote', location: 'India', skills: ['Jest'], openings: 1 }),
    });
    assert.equal(created.status, 201);
    const page = await openPage();
    await waitFor(() => cardTitles(page).includes('Temporary Frontend Test Role'), 'the new record');
    assert.ok(!appJs.includes('INT-101'), 'app.js must not contain the seed records');
    await fetch(`${baseUrl}/api/internships/INT-FE1`, { method: 'DELETE' });
  });

  test('the domain list is built from the API', async () => {
    const page = await openPage();
    await waitFor(() => page.$('domain').options.length > 1, 'domain options');
    const options = [...page.$('domain').options].map((o) => o.textContent);
    assert.deepEqual(options, ['All domains', 'Cyber Security', 'Data Analytics', 'Full Stack Development', 'UI/UX']);
  });

  test('search and filters send the right API request and show the matching cards', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'initial cards');

    page.$('search').value = 'sql';
    page.$('filter-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await waitFor(() => cards(page).length === 2, 'two cards for "sql"');
    assert.deepEqual(cardTitles(page), ['API Engineering Intern', 'Data Analyst Intern']);

    page.$('mode').value = 'Hybrid';
    page.$('mode').dispatchEvent(new page.window.Event('change'));
    await waitFor(() => cards(page).length === 1, 'one card for sql + Hybrid');
    assert.deepEqual(cardTitles(page), ['API Engineering Intern']);
    const last = page.net.calls[page.net.calls.length - 1].url;
    assert.ok(last.includes('search=sql') && last.includes('mode=Hybrid'), last);
  });

  test('shows a helpful empty state when nothing matches, and Clear brings the list back', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'initial cards');
    page.$('search').value = 'zzz-no-match';
    page.$('filter-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await waitFor(() => !page.$('state-empty').hidden, 'empty state');
    assert.match(page.$('state-empty').textContent, /No internships match/);
    assert.equal(page.$('card-list').hidden, true);

    page.$('empty-clear').click();
    await waitFor(() => cards(page).length === 5, 'cards after clearing');
    assert.equal(page.$('search').value, '');
  });

  test('shows a friendly error when the API is unreachable, and Retry sends a new request that recovers', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'initial cards');

    page.net.offline = true;
    page.$('search').value = 'frontend';
    page.$('filter-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await waitFor(() => !page.$('state-error').hidden, 'error state');
    assert.match(page.$('state-error-text').textContent, /Could not reach the server/);
    assert.equal(page.$('state-error').getAttribute('role'), 'alert');
    assert.ok(!/TypeError|Failed to fetch|stack/.test(page.$('state-error').textContent), 'no technical details in the message');

    const before = page.net.calls.length;
    page.net.offline = false;
    page.$('retry-list').click();
    await waitFor(() => cards(page).length === 1, 'cards after retry');
    assert.ok(page.net.calls.length > before, 'Retry must send another API request');
    assert.ok(page.$('state-error').hidden);
  });
});

describe('Application form', () => {
  test('opening an internship fetches its details and links the form to it', async () => {
    const page = await openPage();
    await openApplyForm(page);
    assert.ok(page.net.calls.some((c) => c.url === '/api/internships/INT-101'));
    assert.equal(page.$('dialog-title').textContent, 'Frontend Intern');
    assert.equal(page.$('apply-target').textContent, 'Applying for: Frontend Intern (INT-101)');
  });

  test('every field has a label and its error message element is linked with aria-describedby', async () => {
    const page = await openPage();
    for (const id of ['applicant-name', 'applicant-email', 'resume-url', 'cover-letter']) {
      const input = page.$(id);
      assert.ok(page.document.querySelector(`label[for="${id}"]`), `${id} needs a label`);
      for (const describedBy of input.getAttribute('aria-describedby').split(' ')) assert.ok(page.$(describedBy), `${id} points at missing #${describedBy}`);
    }
  });

  test('client-side checks block bad input before any request is sent, with field-specific messages', async () => {
    const page = await openPage();
    await openApplyForm(page);
    const before = posts(page).length;

    submit(page);
    assert.equal(page.$('applicant-name-error').textContent, 'Enter your full name.');
    assert.equal(page.$('applicant-email-error').textContent, 'Enter your email address.');
    assert.equal(page.$('resume-url-error').textContent, 'Enter a link to your resume.');
    assert.equal(page.$('applicant-name').getAttribute('aria-invalid'), 'true');
    assert.equal(page.document.activeElement, page.$('applicant-name'), 'focus goes to the first invalid field');
    assert.match(page.$('apply-error').textContent, /correct the highlighted fields/);

    fillForm(page, { name: 'Asha Verma', email: 'asha@example.com', resume: 'javascript:alert(1)' });
    submit(page);
    assert.match(page.$('resume-url-error').textContent, /must start with http/);
    assert.equal(page.$('applicant-name-error').textContent, '', 'old errors are cleared');
    assert.equal(posts(page).length, before, 'no API request for invalid input');
  });

  test('a valid application is sent to the real API, saved, and confirmed on screen', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Frontend Tester', email: 'fe-ok@example.com', resume: 'https://example.com/fe.pdf', letter: 'Hello team' });
    submit(page);
    assert.equal(page.$('apply-submit').disabled, true, 'button is disabled while submitting');
    assert.equal(page.$('apply-progress').textContent, 'Submitting your application…');

    await waitFor(() => page.$('apply-success').textContent !== '', 'success message');
    assert.match(page.$('apply-success').textContent, /Application submitted/);
    assert.equal(page.$('apply-submit').disabled, false);
    assert.equal(page.$('applicant-email').value, '', 'form is cleared after success');
    assert.equal(page.document.activeElement, page.$('apply-success'), 'focus moves to the confirmation');

    const body = JSON.parse(await (await fetch(`${baseUrl}/api/internships/INT-101`)).text());
    assert.equal(body.status, 'success');
    const row = database.db.prepare('SELECT * FROM applications WHERE applicant_email = ?').get('fe-ok@example.com');
    assert.equal(row.internship_id, 'INT-101');
    assert.equal(row.resume_url, 'https://example.com/fe.pdf');
    assert.equal(row.cover_letter, 'Hello team');
  });

  test('double-clicking Submit sends only one request', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Double Click', email: 'fe-double@example.com', resume: 'https://example.com/d.pdf' });
    let release;
    page.net.gate = new Promise((resolve) => { release = resolve; });
    const before = posts(page).length;
    submit(page);
    submit(page);
    submit(page);
    assert.equal(posts(page).length - before, 1);
    page.net.gate = null;
    release();
    await waitFor(() => page.$('apply-success').textContent !== '', 'success');
    assert.equal(posts(page).length - before, 1);
  });

  test('a duplicate application shows a clear message and keeps what the person typed', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Dup Person', email: 'fe-ok@example.com', resume: 'https://example.com/fe.pdf' });
    submit(page);
    await waitFor(() => page.$('apply-error').textContent !== '', 'duplicate message');
    assert.match(page.$('apply-error').textContent, /already applied/);
    assert.equal(page.$('applicant-email').value, 'fe-ok@example.com');
    assert.equal(page.$('apply-submit').disabled, false);
  });

  test('server-side field errors appear next to the right field and the input is preserved', async () => {
    const page = await openPage();
    await openApplyForm(page);
    // Passes the browser checks, but the server refuses control characters in a cover letter.
    fillForm(page, { name: 'Server Check', email: 'fe-server@example.com', resume: 'https://example.com/s.pdf', letter: 'bad\u0007text' });
    submit(page);
    await waitFor(() => page.$('cover-letter-error').textContent !== '', 'server field error');
    assert.match(page.$('cover-letter-error').textContent, /not allowed/);
    assert.equal(page.$('cover-letter').getAttribute('aria-invalid'), 'true');
    assert.equal(page.$('applicant-name').value, 'Server Check');
    assert.equal(page.document.activeElement, page.$('cover-letter'));
  });

  test('network failure shows a message, keeps the values and allows another try', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Offline Person', email: 'fe-offline@example.com', resume: 'https://example.com/o.pdf' });
    page.net.offline = true;
    submit(page);
    await waitFor(() => page.$('apply-error').textContent !== '', 'network error');
    assert.match(page.$('apply-error').textContent, /Could not reach the server/);
    assert.equal(page.$('applicant-name').value, 'Offline Person');
    assert.equal(page.$('apply-submit').disabled, false);

    page.net.offline = false;
    submit(page);
    await waitFor(() => page.$('apply-success').textContent !== '', 'success after retry');
  });

  test('a server failure shows a generic message with no internal details', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Server Down', email: 'fe-500@example.com', resume: 'https://example.com/x.pdf' });
    const quiet = mock.method(console, 'error', () => {});
    const broken = mock.method(database.db, 'prepare', () => { throw new Error('SQLITE_BUSY secret detail'); });
    try {
      submit(page);
      await waitFor(() => page.$('apply-error').textContent !== '', 'server error message');
    } finally {
      broken.mock.restore();
      quiet.mock.restore();
    }
    assert.match(page.$('apply-error').textContent, /server had a problem/);
    assert.ok(!/SQLITE|secret/.test(page.document.body.textContent));
    assert.equal(page.$('applicant-name').value, 'Server Down');
  });

  test('the rate-limit response (429) is explained to the person', async () => {
    const limitedUrl = await startApp({ RATE_LIMIT_APPLICATION_MAX: '1' });
    const page = await openPage(limitedUrl);
    await openApplyForm(page);
    fillForm(page, { name: 'Rate One', email: 'fe-rate1@example.com', resume: 'https://example.com/r.pdf' });
    submit(page);
    await waitFor(() => page.$('apply-success').textContent !== '', 'first submission');

    fillForm(page, { name: 'Rate Two', email: 'fe-rate2@example.com', resume: 'https://example.com/r.pdf' });
    page.$('apply-success').textContent = '';
    submit(page);
    await waitFor(() => page.$('apply-error').textContent !== '', 'rate limit message');
    assert.match(page.$('apply-error').textContent, /Too many applications/);
    assert.equal(page.$('applicant-email').value, 'fe-rate2@example.com');
  });

  test('closing the dialog returns focus to the button that opened it', async () => {
    const page = await openPage();
    await openApplyForm(page);
    const trigger = [...page.document.querySelectorAll('#card-list button')][0];
    page.$('dialog-close').click();
    assert.equal(page.$('details-dialog').hasAttribute('open'), false);
    assert.equal(page.document.activeElement, trigger);
  });

  test('a failed details request shows an error with a working Try again button', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length > 0, 'cards');
    page.net.offline = true;
    [...page.document.querySelectorAll('#card-list button')][0].click();
    await waitFor(() => !page.$('dialog-error').hidden, 'dialog error');
    page.net.offline = false;
    page.$('dialog-retry').click();
    await waitFor(() => !page.$('dialog-content').hidden, 'details after retry');
  });
});
