'use strict';

// Task 3: application endpoint tests (validation, persistence, duplicates, safe errors).
// Runs the real Express app against a throw-away SQLite file.

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { makeTempDatabasePath, listen, close, request, fs } = require('./helpers');

const temp = makeTempDatabasePath('internship-apply-test-');
process.env.DATABASE_PATH = temp.file;
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const database = require('../src/db');

let server;
let baseUrl;
const post = (body, extra) => request(baseUrl, 'POST', '/api/applications', { body, ...extra });

const VALID = {
  internship_id: 'INT-101',
  applicant_name: 'Asha Verma',
  applicant_email: 'asha@example.com',
  resume_url: 'https://example.com/asha-resume.pdf',
  cover_letter: 'I enjoy building accessible interfaces.',
};
// A fresh email for every test that needs a successful insert.
let counter = 0;
const fresh = (overrides = {}) => ({ ...VALID, applicant_email: `person${++counter}@example.com`, ...overrides });

before(async () => {
  ({ server, baseUrl } = await listen(createApp()));
});

after(async () => {
  await close(server);
  database.closeDatabase();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe('Valid applications', () => {
  test('a valid application returns 201 and is stored with every permitted field', async () => {
    const res = await post(VALID);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.message, 'Application submitted successfully');
    assert.equal(res.body.data.internship_id, 'INT-101');
    assert.equal('pagination' in res.body, false);
    assert.ok(!res.text.includes('asha@example.com'), 'response must not echo the email');

    const row = database.db.prepare('SELECT * FROM applications WHERE id = ?').get(res.body.data.application_id);
    assert.equal(row.applicant_name, 'Asha Verma');
    assert.equal(row.applicant_email, 'asha@example.com');
    assert.equal(row.resume_url, 'https://example.com/asha-resume.pdf');
    assert.equal(row.cover_letter, 'I enjoy building accessible interfaces.');
  });

  test('the cover letter is optional (missing, null and blank all store NULL)', async () => {
    for (const letter of [undefined, null, '   ']) {
      const res = await post(fresh({ cover_letter: letter }));
      assert.equal(res.status, 201);
      const row = database.db.prepare('SELECT cover_letter FROM applications WHERE id = ?').get(res.body.data.application_id);
      assert.equal(row.cover_letter, null);
    }
  });

  test('values are trimmed and the email is lower-cased before saving', async () => {
    const res = await post(fresh({ applicant_name: '  Rohan   Mehta  ', applicant_email: '  Rohan.M@Example.COM ' }));
    assert.equal(res.status, 201);
    const row = database.db.prepare('SELECT * FROM applications WHERE id = ?').get(res.body.data.application_id);
    assert.equal(row.applicant_name, 'Rohan Mehta');
    assert.equal(row.applicant_email, 'rohan.m@example.com');
  });

  test('unknown fields are ignored: the client cannot set id, created_at or other columns', async () => {
    const res = await post(fresh({ id: 9999, created_at: '1999-01-01', is_admin: true, status: 'hired' }));
    assert.equal(res.status, 201);
    assert.notEqual(res.body.data.application_id, 9999);
    const row = database.db.prepare('SELECT * FROM applications WHERE id = ?').get(res.body.data.application_id);
    assert.notEqual(row.created_at, '1999-01-01');
    assert.deepEqual(Object.keys(row).sort(), ['applicant_email', 'applicant_name', 'cover_letter', 'created_at', 'id', 'internship_id', 'resume_url']);
  });
});

describe('Validation (400 VALIDATION_ERROR with per-field messages)', () => {
  async function expectFieldError(overrides, field) {
    const res = await post({ ...fresh(), ...overrides });
    assert.equal(res.status, 400, `expected 400 for ${field}: ${JSON.stringify(overrides)}`);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Please correct the submitted information.');
    assert.equal(typeof res.body.error.fields[field], 'string', `expected a "${field}" message`);
    return res;
  }

  test('missing, blank, too short, too long or non-string names are rejected', async () => {
    await expectFieldError({ applicant_name: undefined }, 'applicant_name');
    await expectFieldError({ applicant_name: '   ' }, 'applicant_name');
    await expectFieldError({ applicant_name: 'A' }, 'applicant_name');
    await expectFieldError({ applicant_name: 'A'.repeat(101) }, 'applicant_name');
    await expectFieldError({ applicant_name: 12345 }, 'applicant_name');
    await expectFieldError({ applicant_name: 'Bad\u0000Name' }, 'applicant_name');
  });

  test('invalid emails are rejected', async () => {
    const bad = ['', 'plain', 'a@b', 'a@@b.com', 'a b@example.com', '.a@example.com', 'a..b@example.com', `${'x'.repeat(65)}@example.com`, `a@${'d'.repeat(250)}.com`];
    for (const email of bad) await expectFieldError({ applicant_email: email }, 'applicant_email');
    await expectFieldError({ applicant_email: ['a@example.com'] }, 'applicant_email');
  });

  test('unsafe or malformed resume URLs are rejected', async () => {
    const bad = [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd', 'ftp://example.com/resume.pdf', 'vbscript:msgbox(1)', 'blob:https://example.com/abc',
      'not a url', 'example.com/resume.pdf', '//example.com/resume.pdf', 'https://', 'http://user:pass@example.com/r.pdf',
      'https://example.com/with space.pdf', `https://example.com/${'a'.repeat(2100)}`, '',
    ];
    for (const url of bad) await expectFieldError({ resume_url: url }, 'resume_url');
    await expectFieldError({ resume_url: undefined }, 'resume_url');
    await expectFieldError({ resume_url: { href: 'https://example.com' } }, 'resume_url');
  });

  test('http and https resume URLs are accepted and normalised', async () => {
    for (const url of ['http://example.com/cv', 'https://example.com/a/b.pdf?x=1#top', 'https://sub.example.co.in:8443/cv']) {
      const res = await post(fresh({ resume_url: url }));
      assert.equal(res.status, 201, url);
    }
  });

  test('missing, malformed or over-long internship IDs are rejected with 400', async () => {
    for (const id of [undefined, '', '   ', 'INT 101', "INT-101'; DROP TABLE internships;--", '../etc', 'x'.repeat(51), 101, null]) {
      const res = await post(fresh({ internship_id: id }));
      assert.equal(res.status, 400, `internship_id ${JSON.stringify(id)}`);
      assert.ok(res.body.error.fields.internship_id);
    }
  });

  test('over-long or non-text cover letters are rejected', async () => {
    await expectFieldError({ cover_letter: 'x'.repeat(2001) }, 'cover_letter');
    await expectFieldError({ cover_letter: 42 }, 'cover_letter');
    await expectFieldError({ cover_letter: 'bad\u0007char' }, 'cover_letter');
    const exactly = await post(fresh({ cover_letter: 'x'.repeat(2000) }));
    assert.equal(exactly.status, 201);
  });

  test('line breaks in the cover letter are kept', async () => {
    const res = await post(fresh({ cover_letter: 'Line one\r\nLine two' }));
    assert.equal(res.status, 201);
    const row = database.db.prepare('SELECT cover_letter FROM applications WHERE id = ?').get(res.body.data.application_id);
    assert.equal(row.cover_letter, 'Line one\nLine two');
  });

  test('several problems are reported together', async () => {
    const res = await post({ internship_id: 'INT-101' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['applicant_email', 'applicant_name', 'resume_url']);
  });

  test('a non-object body is rejected', async () => {
    for (const body of [[], 'text', 42, null]) {
      const res = await post(body);
      assert.equal(res.status, 400);
      // Arrays are caught by our validation; bare strings, numbers and null are refused by the JSON parser.
      assert.ok(['VALIDATION_ERROR', 'INVALID_JSON'].includes(res.body.error.code));
    }
  });

  test('rejected applications are never saved', async () => {
    const before = database.db.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
    await post(fresh({ resume_url: 'javascript:alert(1)' }));
    await post(fresh({ applicant_name: '' }));
    const after = database.db.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
    assert.equal(after, before);
  });
});

describe('Missing internship and duplicates', () => {
  test('an unknown internship ID returns 404 INTERNSHIP_NOT_FOUND', async () => {
    const res = await post(fresh({ internship_id: 'INT-999' }));
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'INTERNSHIP_NOT_FOUND');
  });

  test('the same email applying twice returns 409, in any letter case, and stores one row', async () => {
    const body = fresh({ internship_id: 'INT-102' });
    assert.equal((await post(body)).status, 201);
    for (const email of [body.applicant_email, body.applicant_email.toUpperCase(), `  ${body.applicant_email}  `]) {
      const res = await post({ ...body, applicant_email: email });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_APPLICATION');
    }
    const n = database.db.prepare('SELECT COUNT(*) AS n FROM applications WHERE internship_id = ? AND applicant_email = ?').get('INT-102', body.applicant_email).n;
    assert.equal(n, 1);
  });

  test('the same email may apply to a different internship', async () => {
    const body = fresh({ internship_id: 'INT-103' });
    assert.equal((await post(body)).status, 201);
    assert.equal((await post({ ...body, internship_id: 'INT-104' })).status, 201);
  });

  test('simultaneous identical submissions create exactly one application', async () => {
    const body = fresh({ internship_id: 'INT-105' });
    const results = await Promise.all(Array.from({ length: 8 }, () => post(body)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409]);
  });

  test('the database itself rejects a duplicate even if the application check is bypassed', () => {
    const insert = database.db.prepare('INSERT INTO applications (internship_id, applicant_name, applicant_email, resume_url) VALUES (?, ?, ?, ?)');
    insert.run('INT-101', 'Direct', 'direct-insert@example.com', 'https://example.com/r');
    assert.throws(() => insert.run('INT-101', 'Direct', 'DIRECT-INSERT@example.com', 'https://example.com/r'), (err) => database.isConstraintError(err));
  });

  test('the database rejects over-long resume links and cover letters', () => {
    const insert = database.db.prepare('INSERT INTO applications (internship_id, applicant_name, applicant_email, resume_url, cover_letter) VALUES (?, ?, ?, ?, ?)');
    assert.throws(() => insert.run('INT-101', 'Long', 'long1@example.com', 'https://e.com/' + 'a'.repeat(2100), null), (err) => database.isConstraintError(err));
    assert.throws(() => insert.run('INT-101', 'Long', 'long2@example.com', 'https://e.com/', 'x'.repeat(2001)), (err) => database.isConstraintError(err));
  });
});

describe('Safe database use and safe errors', () => {
  test('SQL injection text is stored as plain text and nothing is damaged', async () => {
    const payload = "Robert'); DROP TABLE applications;--";
    const res = await post(fresh({ applicant_name: payload, cover_letter: "' OR 1=1; DELETE FROM internships;--" }));
    assert.equal(res.status, 201);
    const row = database.db.prepare('SELECT applicant_name, cover_letter FROM applications WHERE id = ?').get(res.body.data.application_id);
    assert.equal(row.applicant_name, payload);
    assert.equal(row.cover_letter, "' OR 1=1; DELETE FROM internships;--");
    assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM internships').get().n, 5);
  });

  test('every database statement in the application controller uses ? placeholders', () => {
    const source = fs.readFileSync(require.resolve('../src/controllers/applicationController'), 'utf8');
    const statements = [...source.matchAll(/\.prepare\(\s*([\s\S]*?)\s*\)\s*\./g)].map((m) => m[1]);
    assert.ok(statements.length >= 3, 'expected to find the prepared statements');
    for (const sql of statements) {
      assert.ok(!sql.includes('${'), `template interpolation inside SQL: ${sql}`);
      assert.ok(!/['"`]\s*\+/.test(sql), `string concatenation inside SQL: ${sql}`);
      assert.ok(sql.includes('?'), `no placeholder in: ${sql}`);
    }
  });

  test('a database failure returns a generic 500 and leaks nothing', async () => {
    const quiet = mock.method(console, 'error', () => {});
    const broken = mock.method(database.db, 'prepare', () => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed at C:\\secret\\path\\internship-board.db');
    });
    try {
      const res = await post(fresh());
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { status: 'error', error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } });
      for (const leak of ['SQLITE', 'secret', 'internship-board.db', 'at Object', 'node_modules', 'stack']) {
        assert.ok(!res.text.includes(leak), `response leaked "${leak}"`);
      }
    } finally {
      broken.mock.restore();
      quiet.mock.restore();
    }
  });

  test('the server still works after a database failure', async () => {
    const res = await post(fresh());
    assert.equal(res.status, 201);
  });
});

describe('Malformed and oversized requests', () => {
  test('malformed JSON returns 400 INVALID_JSON and does not echo the body', async () => {
    const res = await request(baseUrl, 'POST', '/api/applications', { rawBody: '{"applicant_email":"leak@example.com",', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
    assert.ok(!res.text.includes('leak@example.com'));
    assert.ok(!res.text.includes('SyntaxError'));
  });

  test('a body over the 10 KB limit is refused without being processed', async () => {
    const before = database.db.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
    const res = await post(fresh({ cover_letter: 'x'.repeat(20000) }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM applications').get().n, before);
  });

  test('a non-JSON content type returns 415', async () => {
    const res = await request(baseUrl, 'POST', '/api/applications', {
      rawBody: 'applicant_name=Asha&applicant_email=a@example.com',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    const plain = await request(baseUrl, 'POST', '/api/applications', { rawBody: 'hello', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(plain.status, 415);
  });

  test('a prototype-pollution style body is harmless', async () => {
    const good = fresh();
    const rawBody = `{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"internship_id":"INT-101","applicant_name":"${good.applicant_name}","applicant_email":"${good.applicant_email}","resume_url":"${good.resume_url}"}`;
    const res = await request(baseUrl, 'POST', '/api/applications', { rawBody, headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 201);
    assert.equal({}.admin, undefined);
    assert.equal(Object.prototype.admin, undefined);
  });
});
