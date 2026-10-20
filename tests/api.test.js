'use strict';

// API tests: they start the real Express app against a throw-away SQLite file,
// so your real database is never touched. Run with:  npm test

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// These must be set BEFORE the app is loaded.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internship-api-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../src/server');
const database = require('../src/db');

const SEED_RECORDS = [
  { id: 'INT-101', title: 'Frontend Intern', domain: 'Full Stack Development', mode: 'Remote', location: 'India', skills: ['HTML', 'CSS', 'JavaScript'], openings: 3 },
  { id: 'INT-102', title: 'API Engineering Intern', domain: 'Full Stack Development', mode: 'Hybrid', location: 'Pune', skills: ['Node.js', 'SQL', 'Testing'], openings: 2 },
  { id: 'INT-103', title: 'UI/UX Intern', domain: 'UI/UX', mode: 'Remote', location: 'India', skills: ['Figma', 'Research', 'Accessibility'], openings: 1 },
  { id: 'INT-104', title: 'Data Analyst Intern', domain: 'Data Analytics', mode: 'On-site', location: 'Bengaluru', skills: ['Excel', 'SQL', 'Data visualisation'], openings: 2 },
  { id: 'INT-105', title: 'Security Operations Intern', domain: 'Cyber Security', mode: 'Remote', location: 'India', skills: ['Linux', 'Logs', 'Networking'], openings: 1 },
];

const VALID_INTERNSHIP = {
  id: 'INT-106',
  title: 'Backend Developer Intern',
  domain: 'Full Stack Development',
  mode: 'Remote',
  location: 'India',
  skills: ['Node.js', 'Express', 'SQLite'],
  openings: 2,
};

let server;
let baseUrl;

async function api(method, urlPath, body, rawBody) {
  const options = { method, headers: {} };
  if (rawBody !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = rawBody;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + urlPath, options);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: response.status, body: json, text };
}

function assertErrorShape(res, status, code) {
  assert.equal(res.status, status);
  assert.equal(res.body.status, 'error');
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  database.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Health and routing', () => {
  test('GET /api/health returns 200 with the success envelope', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    // Task 4 added database / uptime / version to `data`; the original envelope and message are unchanged.
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.message, 'Internship API is running');
    assert.equal(res.body.data.database, 'ok');
    assert.equal(typeof res.body.data.uptime_seconds, 'number');
    assert.equal(typeof res.body.data.version, 'string');
    assert.equal('pagination' in res.body, false);
  });

  test('unknown API route returns 404 ROUTE_NOT_FOUND', async () => {
    const res = await api('GET', '/api/does-not-exist');
    assertErrorShape(res, 404, 'ROUTE_NOT_FOUND');
    assert.equal(res.body.error.message, 'API route not found');
  });

  test('the front end page is served at /', async () => {
    const res = await fetch(baseUrl + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Internship Board/);
  });
});

describe('Seed data', () => {
  test('INT-101 to INT-105 exist with the exact supplied values and array skills', async () => {
    const res = await api('GET', '/api/internships');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, SEED_RECORDS);
  });
});

describe('List, pagination, search and filters', () => {
  test('GET /api/internships returns all records with default pagination', async () => {
    const res = await api('GET', '/api/internships');
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.length, 5);
    assert.deepEqual(res.body.pagination, { page: 1, limit: 10, total: 5, totalPages: 1 });
  });

  test('pagination: page 1 and 2 with limit 2', async () => {
    const page1 = await api('GET', '/api/internships?page=1&limit=2');
    assert.deepEqual(page1.body.data.map((i) => i.id), ['INT-101', 'INT-102']);
    assert.deepEqual(page1.body.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });

    const page3 = await api('GET', '/api/internships?page=3&limit=2');
    assert.deepEqual(page3.body.data.map((i) => i.id), ['INT-105']);
  });

  test('pagination: a page past the end returns an empty list, not an error', async () => {
    const res = await api('GET', '/api/internships?page=99&limit=2');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.pagination.total, 5);
  });

  test('pagination: invalid page / limit values return 400 VALIDATION_ERROR', async () => {
    const cases = [
      ['page=0', 'page'], ['page=-1', 'page'], ['page=abc', 'page'], ['page=1.5', 'page'],
      ['limit=0', 'limit'], ['limit=abc', 'limit'], ['limit=101', 'limit'], ['limit=-5', 'limit'],
      ['page=1&page=2', 'page'],
    ];
    for (const [query, field] of cases) {
      const res = await api('GET', `/api/internships?${query}`);
      assertErrorShape(res, 400, 'VALIDATION_ERROR');
      assert.ok(res.body.error.fields[field], `expected a "${field}" error for ?${query}`);
    }
  });

  test('limit=100 (the maximum) is accepted', async () => {
    const res = await api('GET', '/api/internships?limit=100');
    assert.equal(res.status, 200);
  });

  test('search matches the title, case-insensitively', async () => {
    const lower = await api('GET', '/api/internships?search=frontend');
    assert.deepEqual(lower.body.data.map((i) => i.id), ['INT-101']);
    const upper = await api('GET', '/api/internships?search=FRONTEND');
    assert.deepEqual(upper.body.data.map((i) => i.id), ['INT-101']);
  });

  test('search matches skills, location and domain', async () => {
    const skill = await api('GET', '/api/internships?search=sql');
    assert.deepEqual(skill.body.data.map((i) => i.id), ['INT-102', 'INT-104']);
    const location = await api('GET', '/api/internships?search=pune');
    assert.deepEqual(location.body.data.map((i) => i.id), ['INT-102']);
    const domain = await api('GET', '/api/internships?search=cyber');
    assert.deepEqual(domain.body.data.map((i) => i.id), ['INT-105']);
  });

  test('search with no match returns an empty list and zero pages', async () => {
    const res = await api('GET', '/api/internships?search=zzzzzz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.deepEqual(res.body.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  test('search treats % and _ as plain characters, not wildcards', async () => {
    const percent = await api('GET', '/api/internships?search=%25');
    assert.equal(percent.body.pagination.total, 0);
    const underscore = await api('GET', '/api/internships?search=_');
    assert.equal(underscore.body.pagination.total, 0);
  });

  test('search ignores JSON punctuation stored in the skills column', async () => {
    const res = await api('GET', '/api/internships?search=' + encodeURIComponent('["'));
    assert.equal(res.body.pagination.total, 0);
  });

  test('domain filter: UI/UX', async () => {
    const res = await api('GET', '/api/internships?domain=UI/UX');
    assert.deepEqual(res.body.data.map((i) => i.id), ['INT-103']);
  });

  test('domain filter: multi-word domain and case-insensitive match', async () => {
    const res = await api('GET', '/api/internships?domain=full%20stack%20development');
    assert.deepEqual(res.body.data.map((i) => i.id), ['INT-101', 'INT-102']);
  });

  test('mode filter: Remote', async () => {
    const res = await api('GET', '/api/internships?mode=Remote');
    assert.deepEqual(res.body.data.map((i) => i.id), ['INT-101', 'INT-103', 'INT-105']);
  });

  test('mode filter: Hybrid and On-site; lowercase is accepted', async () => {
    const hybrid = await api('GET', '/api/internships?mode=Hybrid');
    assert.deepEqual(hybrid.body.data.map((i) => i.id), ['INT-102']);
    const onsite = await api('GET', '/api/internships?mode=on-site');
    assert.deepEqual(onsite.body.data.map((i) => i.id), ['INT-104']);
  });

  test('mode filter: an unknown mode returns 400', async () => {
    const res = await api('GET', '/api/internships?mode=Moon');
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.mode);
  });

  test('search + domain + mode + pagination work together', async () => {
    const res = await api('GET', '/api/internships?search=intern&domain=Full%20Stack%20Development&mode=Remote&page=1&limit=5');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((i) => i.id), ['INT-101']);
    assert.deepEqual(res.body.pagination, { page: 1, limit: 5, total: 1, totalPages: 1 });
  });

  test('SQL injection attempts in search and domain do not return extra rows or break anything', async () => {
    const search = await api('GET', '/api/internships?search=' + encodeURIComponent("' OR 1=1 --"));
    assert.equal(search.status, 200);
    assert.equal(search.body.pagination.total, 0);
    const domain = await api('GET', '/api/internships?domain=' + encodeURIComponent("x' OR '1'='1"));
    assert.equal(domain.body.pagination.total, 0);
    const still = await api('GET', '/api/internships');
    assert.equal(still.body.pagination.total, 5);
  });
});

describe('Internship detail', () => {
  test('GET /api/internships/INT-101 returns the record', async () => {
    const res = await api('GET', '/api/internships/INT-101');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'success', data: SEED_RECORDS[0] });
  });

  test('missing record returns 404 INTERNSHIP_NOT_FOUND', async () => {
    const res = await api('GET', '/api/internships/INVALID');
    assertErrorShape(res, 404, 'INTERNSHIP_NOT_FOUND');
  });

  test('an injection-style ID is treated as plain text and returns 404', async () => {
    const res = await api('GET', '/api/internships/' + encodeURIComponent("' OR '1'='1"));
    assertErrorShape(res, 404, 'INTERNSHIP_NOT_FOUND');
  });
});

describe('Create internship', () => {
  test('valid create returns 201 and the new record, which can then be fetched', async () => {
    const res = await api('POST', '/api/internships', VALID_INTERNSHIP);
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { status: 'success', data: VALID_INTERNSHIP });

    const fetched = await api('GET', '/api/internships/INT-106');
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body.data, VALID_INTERNSHIP);
  });

  test('values are trimmed before saving', async () => {
    const res = await api('POST', '/api/internships', {
      ...VALID_INTERNSHIP, id: ' INT-TRIM ', title: '  Trim Intern  ', skills: [' Node.js '],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, 'INT-TRIM');
    assert.equal(res.body.data.title, 'Trim Intern');
    assert.deepEqual(res.body.data.skills, ['Node.js']);
    await api('DELETE', '/api/internships/INT-TRIM');
  });

  const invalidCases = [
    ['missing id', { id: undefined }, 'id'],
    ['missing title', { title: undefined }, 'title'],
    ['blank title', { title: '   ' }, 'title'],
    ['missing domain', { domain: undefined }, 'domain'],
    ['missing mode', { mode: undefined }, 'mode'],
    ['invalid mode', { mode: 'Underwater' }, 'mode'],
    ['missing location', { location: undefined }, 'location'],
    ['skills missing', { skills: undefined }, 'skills'],
    ['skills not an array', { skills: 'Node.js' }, 'skills'],
    ['skills empty array', { skills: [] }, 'skills'],
    ['skills containing a blank string', { skills: ['Node.js', ' '] }, 'skills'],
    ['skills containing a number', { skills: ['Node.js', 5] }, 'skills'],
    ['negative openings', { openings: -1 }, 'openings'],
    ['decimal openings', { openings: 1.5 }, 'openings'],
    ['openings as a string', { openings: '3' }, 'openings'],
    ['openings missing', { openings: undefined }, 'openings'],
    ['id with unsafe characters', { id: 'INT 1;DROP' }, 'id'],
  ];
  for (const [name, change, field] of invalidCases) {
    test(`invalid create (${name}) returns 400 with a "${field}" field error`, async () => {
      const res = await api('POST', '/api/internships', { ...VALID_INTERNSHIP, id: 'INT-BAD', ...change });
      assertErrorShape(res, 400, 'VALIDATION_ERROR');
      assert.equal(res.body.error.message, 'Invalid internship data');
      assert.ok(res.body.error.fields[field], `expected fields.${field}`);
    });
  }

  test('several problems are reported together', async () => {
    const res = await api('POST', '/api/internships', { id: 'INT-BAD', openings: -4 });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    const names = Object.keys(res.body.error.fields).sort();
    assert.deepEqual(names, ['domain', 'location', 'mode', 'openings', 'skills', 'title']);
  });

  test('invalid creates did not save anything', async () => {
    const res = await api('GET', '/api/internships/INT-BAD');
    assert.equal(res.status, 404);
  });

  test('an empty or non-object body returns 400', async () => {
    const empty = await api('POST', '/api/internships');
    assertErrorShape(empty, 400, 'VALIDATION_ERROR');
    const array = await api('POST', '/api/internships', [1, 2]);
    assertErrorShape(array, 400, 'VALIDATION_ERROR');
  });

  test('malformed JSON returns 400 INVALID_JSON without leaking details', async () => {
    const res = await api('POST', '/api/internships', undefined, '{"id": "INT-9", ');
    assertErrorShape(res, 400, 'INVALID_JSON');
    assert.ok(!res.text.includes('SyntaxError'));
    assert.ok(!res.text.includes('node_modules'));
  });

  test('creating INT-101 again returns 409 DUPLICATE_ID', async () => {
    const res = await api('POST', '/api/internships', { ...VALID_INTERNSHIP, id: 'INT-101' });
    assertErrorShape(res, 409, 'DUPLICATE_ID');
    assert.equal(res.body.error.message, 'An internship with this ID already exists');
    const original = await api('GET', '/api/internships/INT-101');
    assert.equal(original.body.data.title, 'Frontend Intern'); // not overwritten
  });
});

describe('Update internship', () => {
  const update = {
    title: 'Backend Engineer Intern',
    domain: 'Full Stack Development',
    mode: 'Hybrid',
    location: 'Pune',
    skills: ['Node.js', 'Express', 'SQLite', 'Testing'],
    openings: 5,
  };

  test('PUT updates an existing record and returns 200', async () => {
    const res = await api('PUT', '/api/internships/INT-106', update);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'success', data: { id: 'INT-106', ...update } });

    const fetched = await api('GET', '/api/internships/INT-106');
    assert.deepEqual(fetched.body.data, { id: 'INT-106', ...update });
  });

  test('sending the same ID in the body is allowed', async () => {
    const res = await api('PUT', '/api/internships/INT-106', { ...update, id: 'INT-106' });
    assert.equal(res.status, 200);
  });

  test('trying to change the ID through the body returns 400 and changes nothing', async () => {
    const res = await api('PUT', '/api/internships/INT-106', { ...update, id: 'INT-999' });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.id);
    assert.equal((await api('GET', '/api/internships/INT-999')).status, 404);
    assert.equal((await api('GET', '/api/internships/INT-106')).status, 200);
  });

  test('invalid update data returns 400 and the record is unchanged', async () => {
    const res = await api('PUT', '/api/internships/INT-106', { ...update, mode: 'Nope', openings: -2 });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.mode);
    assert.ok(res.body.error.fields.openings);
    const fetched = await api('GET', '/api/internships/INT-106');
    assert.equal(fetched.body.data.mode, 'Hybrid');
  });

  test('updating a missing record returns 404', async () => {
    const res = await api('PUT', '/api/internships/INT-404', update);
    assertErrorShape(res, 404, 'INTERNSHIP_NOT_FOUND');
  });
});

describe('Applications', () => {
  const application = {
    internship_id: 'INT-101',
    applicant_name: 'John Doe',
    applicant_email: 'john@example.com',
    resume_url: 'https://example.com/john-doe-resume.pdf', // required since Task 3
  };

  test('valid application returns 201 and does not echo applicant details', async () => {
    const res = await api('POST', '/api/applications', application);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.message, 'Application submitted successfully');
    assert.equal(typeof res.body.data.application_id, 'number');
    assert.ok(!res.text.includes('john@example.com'));
    assert.ok(!res.text.includes('John Doe'));
  });

  test('the application row is stored in the database', () => {
    const row = database.db.prepare('SELECT * FROM applications WHERE internship_id = ?').get('INT-101');
    assert.equal(row.applicant_email, 'john@example.com');
    assert.equal(row.applicant_name, 'John Doe');
  });

  test('missing applicant name returns 400', async () => {
    const res = await api('POST', '/api/applications', { ...application, applicant_name: undefined });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.applicant_name);
  });

  test('blank applicant name returns 400', async () => {
    const res = await api('POST', '/api/applications', { ...application, applicant_name: '   ' });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
  });

  test('invalid emails return 400', async () => {
    const bad = ['not-an-email', 'john@', '@example.com', 'john@example', 'john smith@example.com', 'john@@example.com'];
    for (const email of bad) {
      const res = await api('POST', '/api/applications', { ...application, applicant_email: email });
      assertErrorShape(res, 400, 'VALIDATION_ERROR');
      assert.ok(res.body.error.fields.applicant_email, `expected "${email}" to be rejected`);
    }
  });

  test('missing email returns 400', async () => {
    const res = await api('POST', '/api/applications', { ...application, applicant_email: undefined });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
  });

  test('missing internship_id returns 400', async () => {
    const res = await api('POST', '/api/applications', { ...application, internship_id: undefined });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.internship_id);
  });

  test('a non-existing internship returns 404', async () => {
    const res = await api('POST', '/api/applications', { ...application, internship_id: 'INT-404' });
    assertErrorShape(res, 404, 'INTERNSHIP_NOT_FOUND');
  });

  test('applying twice with the same email returns 409 DUPLICATE_APPLICATION', async () => {
    const res = await api('POST', '/api/applications', application);
    assertErrorShape(res, 409, 'DUPLICATE_APPLICATION');
    assert.equal(res.body.error.message, 'This applicant has already applied for this internship');
  });

  test('the same email in different letter case is also a duplicate', async () => {
    const res = await api('POST', '/api/applications', { ...application, applicant_email: 'JOHN@Example.com' });
    assertErrorShape(res, 409, 'DUPLICATE_APPLICATION');
  });

  test('the same email can apply to a different internship', async () => {
    const res = await api('POST', '/api/applications', { ...application, internship_id: 'INT-102' });
    assert.equal(res.status, 201);
  });

  test('a different email can apply to the same internship', async () => {
    const res = await api('POST', '/api/applications', { ...application, applicant_email: 'jane@example.com' });
    assert.equal(res.status, 201);
  });

  test('malformed JSON on /api/applications returns 400 and does not leak the body', async () => {
    const res = await api('POST', '/api/applications', undefined, '{"applicant_email": "secret@example.com", ');
    assertErrorShape(res, 400, 'INVALID_JSON');
    assert.ok(!res.text.includes('secret@example.com'));
  });
});

describe('Delete internship', () => {
  test('an internship that has applications cannot be deleted (409)', async () => {
    const res = await api('DELETE', '/api/internships/INT-101');
    assertErrorShape(res, 409, 'INTERNSHIP_HAS_APPLICATIONS');
    assert.equal((await api('GET', '/api/internships/INT-101')).status, 200);
  });

  test('DELETE removes the test internship and returns 200', async () => {
    const res = await api('DELETE', '/api/internships/INT-106');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'success', data: { message: 'Internship deleted successfully' } });
    assert.equal((await api('GET', '/api/internships/INT-106')).status, 404);
  });

  test('deleting a missing record returns 404', async () => {
    const res = await api('DELETE', '/api/internships/INT-106');
    assertErrorShape(res, 404, 'INTERNSHIP_NOT_FOUND');
  });

  test('after all the above, the five seed records are still there', async () => {
    const res = await api('GET', '/api/internships');
    assert.equal(res.body.pagination.total, 5);
  });
});

describe('Database safety', () => {
  test('applications table has a UNIQUE rule that the database itself enforces', () => {
    const insert = database.db.prepare(
      'INSERT INTO applications (internship_id, applicant_name, applicant_email) VALUES (?, ?, ?)'
    );
    insert.run('INT-103', 'Direct Insert', 'direct@example.com');
    assert.throws(() => insert.run('INT-103', 'Direct Insert', 'DIRECT@example.com'), (err) => {
      assert.equal(database.isConstraintError(err), true);
      return true;
    });
  });

  test('foreign keys are enforced: an application for a missing internship is rejected by SQLite', () => {
    assert.throws(
      () => database.db
        .prepare('INSERT INTO applications (internship_id, applicant_name, applicant_email) VALUES (?, ?, ?)')
        .run('INT-NOPE', 'Nobody', 'nobody@example.com'),
      (err) => database.isConstraintError(err)
    );
  });

  test('isConstraintError is false for ordinary errors', () => {
    assert.equal(database.isConstraintError(new Error('boom')), false);
    assert.equal(database.isConstraintError(null), false);
  });
});

describe('Response contract', () => {
  test('every success and error response uses the documented envelope', async () => {
    const calls = [
      ['GET', '/api/health'],
      ['GET', '/api/internships'],
      ['GET', '/api/internships/INT-102'],
      ['GET', '/api/internships/NOPE'],
      ['GET', '/api/internships?page=0'],
      ['POST', '/api/internships', {}],
      ['POST', '/api/applications', {}],
      ['GET', '/api/nope'],
    ];
    for (const [method, url, body] of calls) {
      const res = await api(method, url, body);
      assert.ok(['success', 'error'].includes(res.body.status), `${method} ${url}`);
      if (res.body.status === 'success') {
        assert.ok('data' in res.body, `${method} ${url} needs data`);
        assert.ok(res.status === 200 || res.status === 201);
      } else {
        assert.deepEqual(Object.keys(res.body).sort(), ['error', 'status']);
        assert.equal(typeof res.body.error.code, 'string');
        assert.equal(typeof res.body.error.message, 'string');
        assert.ok([400, 404, 409, 500].includes(res.status));
      }
    }
  });
});
