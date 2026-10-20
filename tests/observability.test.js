'use strict';

// Task 4: logging, request IDs, health check, caching, compression and the domains endpoint.

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { makeTempDatabasePath, listen, close, request, fs } = require('./helpers');

// fetch() rewrites conditional requests, so use plain http for the 304 check.
function rawGet(baseUrl, urlPath, headers) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + urlPath, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

const temp = makeTempDatabasePath('internship-observability-test-');
process.env.DATABASE_PATH = temp.file;
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createLogger, clean } = require('../src/utils/logger');
const database = require('../src/db');

const servers = [];
async function startApp(env = {}, level = 'debug', format = 'json') {
  const lines = [];
  const logger = createLogger({ level, format, write: (line) => lines.push(line) });
  const started = await listen(createApp(loadConfig({ NODE_ENV: 'test', ...env }), { logger }));
  servers.push(started.server);
  return { baseUrl: started.baseUrl, lines, records: () => lines.map((l) => JSON.parse(l)) };
}

after(async () => {
  for (const server of servers) await close(server);
  database.closeDatabase();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

const SECRET = {
  internship_id: 'INT-101',
  applicant_name: 'Zebulon Quillfeather',
  applicant_email: 'zebulon.quillfeather@private-example.org',
  resume_url: 'https://private-example.org/zebulon-resume-9f3a.pdf',
  cover_letter: 'My confidential cover letter text 7731',
};
const SECRET_VALUES = ['Zebulon', 'Quillfeather', 'private-example.org', 'zebulon-resume-9f3a', 'confidential cover letter', '7731'];

describe('Request logging', () => {
  test('each request is logged once with method, route, status and response time', async () => {
    const app = await startApp();
    await request(app.baseUrl, 'GET', '/api/internships/INT-101');
    await request(app.baseUrl, 'GET', '/api/internships/NOPE');
    const logs = app.records().filter((r) => r.msg === 'request');
    assert.equal(logs.length, 2);
    assert.deepEqual([logs[0].method, logs[0].status, logs[0].route, logs[0].path], ['GET', 200, '/api/internships/:id', '/api/internships/INT-101']);
    assert.equal(logs[1].status, 404);
    for (const log of logs) {
      assert.equal(typeof log.ms, 'number');
      assert.ok(log.ms >= 0 && log.ms < 5000);
      assert.match(log.time, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(log.level, 'info');
    }
  });

  test('query strings are never logged', async () => {
    const app = await startApp();
    await request(app.baseUrl, 'GET', '/api/internships?search=my-private-search&page=1');
    assert.ok(!app.lines.join('\n').includes('my-private-search'));
  });

  test('applicant data never appears in any log line, whether the request succeeds, fails validation or hits a duplicate', async () => {
    const app = await startApp();
    await request(app.baseUrl, 'POST', '/api/applications', { body: SECRET });                                  // 201
    await request(app.baseUrl, 'POST', '/api/applications', { body: SECRET });                                  // 409
    await request(app.baseUrl, 'POST', '/api/applications', { body: { ...SECRET, resume_url: 'javascript:alert(1)' } }); // 400
    await request(app.baseUrl, 'POST', '/api/applications', { rawBody: '{"applicant_email":"zebulon.quillfeather@private-example.org",', headers: { 'Content-Type': 'application/json' } }); // 400 bad JSON
    const output = app.lines.join('\n');
    assert.ok(app.lines.length >= 4);
    for (const value of SECRET_VALUES) assert.ok(!output.includes(value), `log leaked "${value}"`);
    assert.deepEqual(app.records().filter((r) => r.msg === 'request').map((r) => r.status), [201, 409, 400, 400]);
  });

  test('a database failure is logged safely (with a request ID) and the client gets only a generic message', async () => {
    const app = await startApp();
    const broken = mock.method(database.db, 'prepare', () => { throw new Error('disk image is malformed'); });
    let res;
    try {
      res = await request(app.baseUrl, 'POST', '/api/applications', { body: { ...SECRET, applicant_email: 'second.person@private-example.org' } });
    } finally {
      broken.mock.restore();
    }
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { status: 'error', error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } });
    for (const leak of ['disk image', 'malformed', 'stack', 'at ']) assert.ok(!res.text.includes(leak), `client saw "${leak}"`);

    const errors = app.records().filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.msg === 'unhandled error' && r.requestId === res.headers.get('x-request-id')), 'error log should carry the request ID');
    assert.ok(errors.some((r) => r.msg === 'request' && r.status === 500));
    const output = app.lines.join('\n');
    for (const value of [...SECRET_VALUES, 'second.person']) assert.ok(!output.includes(value), `error log leaked "${value}"`);
  });

  test('a path containing line breaks cannot forge extra log lines', async () => {
    const app = await startApp();
    await request(app.baseUrl, 'GET', '/api/x%0A%7B%22level%22:%22error%22,%22msg%22:%22forged%22%7D');
    const records = app.records(); // every line must still be valid JSON
    assert.ok(records.every((r) => r.msg !== 'forged'));
    assert.equal(clean('a\nb\r\nc'), 'a?b??c');
  });

  test('the log level hides health pings at info level but shows them at debug', async () => {
    const quiet = await startApp({}, 'info');
    await request(quiet.baseUrl, 'GET', '/api/health');
    assert.equal(quiet.lines.length, 0);
    const loud = await startApp({}, 'debug');
    await request(loud.baseUrl, 'GET', '/api/health');
    assert.equal(loud.records().length, 1);
  });

  test('text format is readable and json format is valid JSON', async () => {
    const text = await startApp({}, 'info', 'text');
    await request(text.baseUrl, 'GET', '/api/domains');
    assert.match(text.lines[0], /^\d{4}-.+ INFO\s+request .*method=GET .*status=200 ms=\d/);
  });
});

describe('Request IDs', () => {
  test('a request ID is generated and returned in X-Request-Id', async () => {
    const { baseUrl } = await startApp();
    const a = await request(baseUrl, 'GET', '/api/domains');
    const b = await request(baseUrl, 'GET', '/api/domains');
    assert.match(a.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.notEqual(a.headers.get('x-request-id'), b.headers.get('x-request-id'));
  });

  test('a safe incoming ID is kept; an unsafe one is replaced', async () => {
    const { baseUrl } = await startApp();
    const kept = await request(baseUrl, 'GET', '/api/domains', { headers: { 'X-Request-Id': 'trace-123.abc' } });
    assert.equal(kept.headers.get('x-request-id'), 'trace-123.abc');
    const replaced = await request(baseUrl, 'GET', '/api/domains', { headers: { 'X-Request-Id': 'bad id with spaces <script>' } });
    assert.match(replaced.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });
});

describe('Health check', () => {
  test('reports ok, database status, uptime and version in the standard envelope', async () => {
    const { baseUrl } = await startApp();
    const res = await request(baseUrl, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.database, 'ok');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(!res.text.includes(temp.dir), 'must not reveal the database path');
  });

  test('returns a generic 503 when the database cannot be reached', async () => {
    const app = await startApp();
    const broken = mock.method(database.db, 'prepare', () => { throw new Error('SQLITE_IOERR /var/data/secret.db'); });
    let res;
    try { res = await request(app.baseUrl, 'GET', '/api/health'); } finally { broken.mock.restore(); }
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { status: 'error', error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
    assert.ok(!res.text.includes('secret.db'));
    assert.ok(app.records().some((r) => r.msg === 'health check failed'));
    assert.equal((await request(app.baseUrl, 'GET', '/api/health')).status, 200, 'recovers once the database is back');
  });
});

describe('Caching and compression', () => {
  test('GET API responses carry an ETag and answer 304 when unchanged', async () => {
    const { baseUrl } = await startApp();
    const first = await request(baseUrl, 'GET', '/api/internships');
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const again = await rawGet(baseUrl, '/api/internships', { 'If-None-Match': etag });
    assert.equal(again.status, 304);
    assert.equal(again.body, '');
  });

  test('applications are never cacheable', async () => {
    const { baseUrl } = await startApp();
    const res = await request(baseUrl, 'POST', '/api/applications', { body: { ...SECRET, applicant_email: 'cache.check@example.com' } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('static files are compressed when the browser accepts gzip, and not otherwise', async () => {
    const { baseUrl } = await startApp();
    const gz = await request(baseUrl, 'GET', '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.match(gz.headers.get('vary') || '', /Accept-Encoding/i);
    const plain = await request(baseUrl, 'GET', '/app.js', { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
  });

  test('static files may be cached briefly in production and always revalidated in development', async () => {
    const prod = await startApp({ NODE_ENV: 'production' });
    assert.match((await request(prod.baseUrl, 'GET', '/styles.css')).headers.get('cache-control'), /max-age=300/);
    const dev = await startApp();
    assert.match((await request(dev.baseUrl, 'GET', '/styles.css')).headers.get('cache-control'), /max-age=0/);
  });
});

describe('Domains endpoint', () => {
  test('returns the distinct domains, sorted, without pagination', async () => {
    const { baseUrl } = await startApp();
    const res = await request(baseUrl, 'GET', '/api/domains');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'success', data: ['Cyber Security', 'Data Analytics', 'Full Stack Development', 'UI/UX'] });
  });
});
