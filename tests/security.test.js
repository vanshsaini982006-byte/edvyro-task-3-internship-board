'use strict';

// Task 3: security middleware tests (headers, rate limiting, CORS, content types, safe errors)
// plus the database migration for databases created in Task 2.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { makeTempDatabasePath, listen, close, request, fs } = require('./helpers');

const temp = makeTempDatabasePath('internship-security-test-');
process.env.DATABASE_PATH = temp.file;
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const database = require('../src/db');

const servers = [];
async function startApp(env = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  const started = await listen(createApp(config));
  servers.push(started.server);
  return started.baseUrl;
}

const application = (n) => ({
  internship_id: 'INT-101',
  applicant_name: 'Rate Test',
  applicant_email: `rate${n}@example.com`,
  resume_url: 'https://example.com/cv.pdf',
});

after(async () => {
  for (const server of servers) await close(server);
  database.closeDatabase();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe('Secure HTTP headers', () => {
  let baseUrl;
  before(async () => { baseUrl = await startApp(); });

  test('API and page responses carry the security headers', async () => {
    for (const url of ['/api/health', '/']) {
      const res = await request(baseUrl, 'GET', url);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
      assert.equal(res.headers.get('x-powered-by'), null, url);
      assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', url);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer', url);
      assert.ok(res.headers.get('strict-transport-security'), url);
    }
  });

  test('the Content-Security-Policy is strict: same-origin only, no inline or wildcard sources', async () => {
    const res = await request(baseUrl, 'GET', '/');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header missing');
    for (const part of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) {
      assert.ok(csp.includes(part), `CSP is missing: ${part}`);
    }
    assert.ok(!csp.includes('*'), 'CSP must not use wildcards');
    assert.ok(!csp.includes('unsafe-inline'), 'CSP must not allow inline code');
    assert.ok(!csp.includes('unsafe-eval'), 'CSP must not allow eval');
  });

  test('the served page uses no inline scripts, inline styles or inline event handlers (so the CSP does not break it)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'inline <script> found');
    assert.ok(!/<style[\s>]/i.test(html), 'inline <style> found');
    assert.ok(!/\sstyle\s*=/i.test(html), 'style attribute found');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), 'inline event handler found');
  });

  test('/config.js tells the browser the API address and defaults to the same server', async () => {
    const res = await request(baseUrl, 'GET', '/config.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.equal(res.text.trim(), 'window.APP_CONFIG = {"apiBaseUrl":""};');
  });

  test('PUBLIC_API_BASE_URL is added to connect-src and ignored when it is not a valid http(s) origin', async () => {
    const custom = await startApp({ PUBLIC_API_BASE_URL: 'https://api.example.com/some/path' });
    const res = await request(custom, 'GET', '/');
    assert.ok(res.headers.get('content-security-policy').includes("connect-src 'self' https://api.example.com"));
    assert.ok((await request(custom, 'GET', '/config.js')).text.includes('"https://api.example.com"'));

    const evil = await startApp({ PUBLIC_API_BASE_URL: 'javascript:alert(1)' });
    assert.ok((await request(evil, 'GET', '/config.js')).text.includes('"apiBaseUrl":""'));
  });
});

describe('Rate limiting (429)', () => {
  test('application submissions are limited per client and the 429 body is safe', async () => {
    const baseUrl = await startApp({ RATE_LIMIT_APPLICATION_MAX: '3' });
    const statuses = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = await request(baseUrl, 'POST', '/api/applications', { body: application(i) });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
    assert.deepEqual(last.body, { status: 'error', error: { code: 'RATE_LIMITED', message: 'Too many applications submitted. Please wait a while before trying again.' } });
    assert.ok(last.headers.get('retry-after'), 'Retry-After header expected');
    assert.ok(last.headers.get('ratelimit'), 'RateLimit header expected');
  });

  test('requests blocked by the limiter are not processed or saved', async () => {
    const baseUrl = await startApp({ RATE_LIMIT_APPLICATION_MAX: '1' });
    await request(baseUrl, 'POST', '/api/applications', { body: application(100) });
    const blocked = await request(baseUrl, 'POST', '/api/applications', { body: application(101) });
    assert.equal(blocked.status, 429);
    const saved = database.db.prepare('SELECT COUNT(*) AS n FROM applications WHERE applicant_email = ?').get('rate101@example.com').n;
    assert.equal(saved, 0);
  });

  test('the limit on applications does not block browsing internships', async () => {
    const baseUrl = await startApp({ RATE_LIMIT_APPLICATION_MAX: '1' });
    await request(baseUrl, 'POST', '/api/applications', { body: application(200) });
    assert.equal((await request(baseUrl, 'POST', '/api/applications', { body: application(201) })).status, 429);
    assert.equal((await request(baseUrl, 'GET', '/api/internships')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/health')).status, 200);
  });

  test('the general API limit also returns 429', async () => {
    const baseUrl = await startApp({ RATE_LIMIT_API_MAX: '4' });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(baseUrl, 'GET', '/api/health')).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  });

  test('invalid or missing limit settings fall back to safe defaults', () => {
    const config = loadConfig({ NODE_ENV: 'production', RATE_LIMIT_APPLICATION_MAX: 'abc', RATE_LIMIT_API_MAX: '-5' });
    assert.equal(config.rateLimit.applicationMax, 10);
    assert.equal(config.rateLimit.apiMax, 300);
    assert.equal(config.rateLimit.windowMs, 15 * 60 * 1000);
  });
});

describe('CORS', () => {
  test('by default no cross-origin access is granted', async () => {
    const baseUrl = await startApp();
    const res = await request(baseUrl, 'GET', '/api/internships', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('only the configured frontend origin is allowed', async () => {
    const baseUrl = await startApp({ CORS_ORIGIN: 'https://frontend.example.com' });
    const allowed = await request(baseUrl, 'GET', '/api/internships', { headers: { Origin: 'https://frontend.example.com' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
    const denied = await request(baseUrl, 'GET', '/api/internships', { headers: { Origin: 'https://evil.example' } });
    assert.notEqual(denied.headers.get('access-control-allow-origin'), '*');
    assert.notEqual(denied.headers.get('access-control-allow-origin'), 'https://evil.example');
    const preflight = await request(baseUrl, 'OPTIONS', '/api/applications', {
      headers: { Origin: 'https://frontend.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
  });
});

describe('Safe errors', () => {
  let baseUrl;
  before(async () => { baseUrl = await startApp(); });

  test('unknown internship IDs return a safe 404', async () => {
    for (const id of ['INT-999', "INT-1'; DROP TABLE internships;--", '%00', '..%2F..%2Fetc%2Fpasswd']) {
      const res = await request(baseUrl, 'GET', `/api/internships/${id}`);
      assert.equal(res.status, 404, id);
      assert.deepEqual(res.body, { status: 'error', error: { code: 'INTERNSHIP_NOT_FOUND', message: 'Internship not found' } });
    }
  });

  test('error responses never contain stack traces, file paths or SQL', async () => {
    const responses = [
      await request(baseUrl, 'GET', '/api/nope'),
      await request(baseUrl, 'GET', '/api/internships?page=abc'),
      await request(baseUrl, 'POST', '/api/applications', { rawBody: '{bad', headers: { 'Content-Type': 'application/json' } }),
      await request(baseUrl, 'POST', '/api/applications', { body: { internship_id: 'INT-404', applicant_name: 'Zed Zed', applicant_email: 'z@example.com', resume_url: 'https://example.com' } }),
      await request(baseUrl, 'POST', '/api/applications', { rawBody: 'x', headers: { 'Content-Type': 'text/plain' } }),
    ];
    for (const res of responses) {
      assert.equal(res.body.status, 'error');
      for (const leak of ['node_modules', 'at Object', 'at Layer', '.js:', 'SELECT ', 'INSERT ', 'sqlite', 'stack']) {
        assert.ok(!res.text.includes(leak), `"${leak}" leaked in: ${res.text}`);
      }
    }
  });

  test('the applications endpoint does not log applicant details', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'applicationController.js'), 'utf8');
    const logLines = source.split('\n').filter((line) => line.includes('console.'));
    for (const line of logLines) {
      for (const field of ['applicantName', 'applicantEmail', 'resumeUrl', 'coverLetter', 'req.body']) {
        assert.ok(!line.includes(field), `log line mentions ${field}: ${line}`);
      }
    }
  });
});

describe('Database migration from a Task 2 database', () => {
  const script = `
    const { db, closeDatabase } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))});
    const columns = db.prepare('PRAGMA table_info(applications)').all().map((c) => c.name);
    const rows = db.prepare('SELECT * FROM applications').all();
    const internships = db.prepare('SELECT COUNT(*) AS n FROM internships').get().n;
    console.log(JSON.stringify({ columns, rows, internships }));
    closeDatabase();
  `;

  test('adds resume_url and cover_letter, keeps existing rows, and is safe to repeat', () => {
    const { DatabaseSync } = require('node:sqlite');
    const old = makeTempDatabasePath('internship-migrate-test-');
    try {
      const legacy = new DatabaseSync(old.file);
      legacy.exec(`
        CREATE TABLE internships (id TEXT PRIMARY KEY, title TEXT NOT NULL, domain TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('Remote','Hybrid','On-site')), location TEXT NOT NULL, skills TEXT NOT NULL,
          openings INTEGER NOT NULL CHECK (openings >= 0));
        CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, internship_id TEXT NOT NULL, applicant_name TEXT NOT NULL,
          applicant_email TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (internship_id, applicant_email), FOREIGN KEY (internship_id) REFERENCES internships(id));
        INSERT INTO internships VALUES ('INT-101','Frontend Intern','Full Stack Development','Remote','India','["HTML"]',3);
        INSERT INTO applications (internship_id, applicant_name, applicant_email) VALUES ('INT-101','Old Applicant','old@example.com');
        PRAGMA user_version = 1;
      `);
      legacy.close();

      const run = () => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '-e', script], {
        env: { ...process.env, DATABASE_PATH: old.file, NODE_ENV: 'test' },
      }).toString());

      const first = run();
      assert.ok(first.columns.includes('resume_url') && first.columns.includes('cover_letter'));
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].applicant_email, 'old@example.com');
      assert.equal(first.rows[0].resume_url, null);
      assert.equal(first.internships, 1, 'existing data must not be reset or re-seeded');

      const second = run();
      assert.deepEqual(second, first);
    } finally {
      fs.rmSync(old.dir, { recursive: true, force: true });
    }
  });
});
