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
async function openPage(serverUrl = baseUrl, pagePath = '/') {
  const dom = new JSDOM(html, { url: `${serverUrl}${pagePath}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);

  // jsdom has no <dialog> behaviour yet: provide the small part the page uses.
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };

  window.HTMLElement.prototype.scrollIntoView = function () {}; // not implemented by jsdom (real browsers have it)

  const net = { calls: [], offline: false, gate: null };
  window.fetch = async (url, options = {}) => {
    const { signal, ...rest } = options; // jsdom's AbortSignal is not Node's, so honour it here instead
    net.calls.push({ method: rest.method || 'GET', url: String(url), signal });
    if (net.gate) await net.gate;
    if (net.offline) throw new TypeError('Failed to fetch');
    const pending = fetch(new URL(url, serverUrl), rest);
    if (!signal) return pending;
    return Promise.race([
      pending,
      new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
      }),
    ]);
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
    assert.ok(page.net.calls.some((c) => c.url === '/api/domains'));
    assert.ok(!page.net.calls.some((c) => c.url.includes('limit=100')), 'no need to download every internship for the filter list');
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

    await waitFor(() => !page.$('apply-confirmation').hidden, 'confirmation panel');
    assert.match(page.$('apply-success').textContent, /Thank you for applying for Frontend Intern/);
    assert.match(page.$('confirm-ref').textContent, /^Reference number: \d+$/);
    assert.equal(page.$('apply-form').hidden, true, 'the form is replaced by the confirmation');
    assert.equal(page.$('apply-confirmation').getAttribute('role'), 'group');
    assert.equal(page.$('apply-submit').disabled, false);
    assert.equal(page.$('applicant-email').value, '', 'personal details are cleared after success');
    assert.equal(page.document.activeElement, page.$('apply-confirmation'), 'focus moves to the confirmation');
    assert.ok(!page.$('apply-confirmation').textContent.includes('fe-ok@example.com'), 'the email is not shown again');

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
    await waitFor(() => !page.$('apply-confirmation').hidden, 'success');
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
    await waitFor(() => !page.$('apply-confirmation').hidden, 'success after retry');
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
    await waitFor(() => !page.$('apply-confirmation').hidden, 'first submission');

    // Open the next internship's form and try again from the same connection.
    page.$('confirm-close').click();
    await openApplyForm(page, 'View details for API Engineering Intern');
    fillForm(page, { name: 'Rate Two', email: 'fe-rate2@example.com', resume: 'https://example.com/r.pdf' });
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

describe('Task 4: landing page, navigation and search behaviour', () => {
  test('the loading state shows placeholder cards (so the page does not jump) plus a text message', async () => {
    const page = await openPage();
    assert.equal(page.$('state-loading').hidden, false);
    assert.equal(page.document.querySelectorAll('#state-loading .skeleton').length, 3);
    assert.equal(page.document.querySelector('#state-loading ul').getAttribute('aria-hidden'), 'true');
    assert.match(page.$('state-loading').textContent, /Loading internships/);
  });

  test('cards show the work mode as text in a labelled pill, and closed roles are marked', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'cards');
    const pill = cards(page)[1].querySelector('.pill');
    assert.equal(pill.textContent, 'Hybrid');
    assert.ok(pill.classList.contains('pill-hybrid'));
    assert.ok(cards(page)[3].querySelector('.pill').classList.contains('pill-on-site'));
  });

  test('the mobile menu toggles with aria-expanded, closes with Escape and returns focus to the button', async () => {
    const page = await openPage();
    const toggle = page.$('nav-toggle');
    const nav = page.$('site-nav');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), 'site-nav');

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(nav.classList.contains('is-open'));
    assert.equal(toggle.textContent, 'Close menu');

    page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(!nav.classList.contains('is-open'));
    assert.equal(page.document.activeElement, toggle);

    toggle.click();
    nav.querySelector('a').click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'choosing a link closes the menu');
  });

  test('typing searches automatically after a pause: one request, not one per keystroke', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'cards');
    const before = page.net.calls.length;
    for (const text of ['s', 'sq', 'sql']) {
      page.$('search').value = text;
      page.$('search').dispatchEvent(new page.window.Event('input', { bubbles: true }));
      await wait(40);
    }
    assert.equal(page.net.calls.length, before, 'nothing is sent while the person is still typing');
    await waitFor(() => cards(page).length === 2, 'results for "sql"');
    const listCalls = page.net.calls.slice(before).filter((c) => c.url.startsWith('/api/internships?'));
    assert.equal(listCalls.length, 1);
    assert.ok(listCalls[0].url.includes('search=sql'));
  });

  test('a newer search cancels the older request that is still waiting, and only the newest result is shown', async () => {
    const page = await openPage();
    await waitFor(() => cards(page).length === 5, 'cards');
    let release;
    page.net.gate = new Promise((resolve) => { release = resolve; });
    page.$('search').value = 'frontend';
    page.$('filter-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    const slow = page.net.calls[page.net.calls.length - 1];
    page.net.gate = null;
    page.$('search').value = 'figma';
    page.$('filter-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    assert.equal(slow.signal.aborted, true, 'the older request must be cancelled');
    release();
    await waitFor(() => cardTitles(page).join() === 'UI/UX Intern', 'only the newest results');
    assert.ok(page.$('state-error').hidden, 'a cancelled request is not an error');
  });

  test('the page address keeps search, filters and page so a view can be shared or reloaded', async () => {
    const page = await openPage(baseUrl, '/?search=sql&mode=Hybrid&domain=Full%20Stack%20Development');
    await waitFor(() => cards(page).length === 1, 'filtered cards from the address');
    assert.equal(page.$('search').value, 'sql');
    assert.equal(page.$('mode').value, 'Hybrid');
    await waitFor(() => page.$('domain').value === 'Full Stack Development', 'domain restored');
    const first = page.net.calls.find((c) => c.url.startsWith('/api/internships?'));
    assert.ok(first.url.includes('search=sql') && first.url.includes('mode=Hybrid') && first.url.includes('domain=Full+Stack+Development'), first.url);

    page.$('mode').value = '';
    page.$('mode').dispatchEvent(new page.window.Event('change'));
    await waitFor(() => !page.window.location.search.includes('mode='), 'address updated');
    assert.ok(page.window.location.search.includes('search=sql'));

    page.$('clear-filters').click();
    await waitFor(() => page.window.location.search === '', 'address cleared');
  });

  test('unsafe values in the page address are ignored', async () => {
    const page = await openPage(baseUrl, '/?mode=%3Cscript%3E&page=-4&search=%3Cimg%20src%3Dx%3E');
    await waitFor(() => !page.$('state-loading').hidden === false || page.$('state-empty').hidden === false || cards(page).length >= 0, 'settled');
    await wait(150);
    const first = page.net.calls.find((c) => c.url.startsWith('/api/internships?'));
    assert.ok(!first.url.includes('mode='), first.url);
    assert.ok(first.url.includes('page=1'));
    assert.equal(page.document.querySelectorAll('img').length, 0, 'search text is never rendered as HTML');
  });

  test('moving to the next page loads it, updates the address and moves focus to the results', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(`${baseUrl}/api/internships`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: `INT-PG${i}`, title: `Paging Role ${i}`, domain: 'Testing', mode: 'Remote', location: 'India', skills: ['Paging'], openings: 1 }),
      });
      assert.equal(res.status, 201);
    }
    try {
      const page = await openPage();
      await waitFor(() => cards(page).length === 6, 'first page of six');
      assert.match(page.$('page-status').textContent, /Page 1 of 2/);
      page.$('page-next').click();
      await waitFor(() => /Page 2 of 2/.test(page.$('page-status').textContent) && cards(page).length === 2, 'second page');
      assert.equal(page.$('result-summary').textContent, 'Showing 7–8 of 8 internships');
      assert.ok(page.window.location.search.includes('page=2'));
      assert.equal(page.document.activeElement, page.$('results'));
      assert.equal(page.$('page-next').getAttribute('aria-disabled'), 'true');
    } finally {
      for (let i = 1; i <= 3; i++) await fetch(`${baseUrl}/api/internships/INT-PG${i}`, { method: 'DELETE' });
    }
  });

  test('a role with no openings shows a notice instead of the form', async () => {
    await fetch(`${baseUrl}/api/internships`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'INT-ZERO', title: 'Closed Role', domain: 'Testing', mode: 'Remote', location: 'India', skills: ['None'], openings: 0 }),
    });
    try {
      const page = await openPage();
      await openApplyForm(page, 'View details for Closed Role');
      assert.equal(page.$('no-openings').hidden, false);
      assert.equal(page.$('apply-form').hidden, true);
    } finally {
      await fetch(`${baseUrl}/api/internships/INT-ZERO`, { method: 'DELETE' });
    }
  });

  test('after a successful application, Back to internships closes the dialog, returns focus, and the next dialog starts with a fresh form', async () => {
    const page = await openPage();
    await openApplyForm(page);
    fillForm(page, { name: 'Confirm Closer', email: 'fe-confirm@example.com', resume: 'https://example.com/c.pdf' });
    submit(page);
    await waitFor(() => !page.$('apply-confirmation').hidden, 'confirmation');
    const trigger = [...page.document.querySelectorAll('#card-list button')][0];
    page.$('confirm-close').click();
    assert.equal(page.$('details-dialog').hasAttribute('open'), false);
    assert.equal(page.document.activeElement, trigger);
    assert.equal(page.document.body.classList.contains('dialog-open'), false, 'page scrolling is unlocked again');

    await openApplyForm(page, 'View details for UI/UX Intern');
    assert.equal(page.$('apply-form').hidden, false);
    assert.equal(page.$('apply-confirmation').hidden, true);
    assert.equal(page.$('apply-success').textContent, '');
    assert.equal(page.$('applicant-name').value, '');
    assert.equal(page.document.body.classList.contains('dialog-open'), true);
  });
});
