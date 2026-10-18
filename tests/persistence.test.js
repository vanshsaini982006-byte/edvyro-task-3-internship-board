'use strict';

// Persistence test: start the server, create a record, STOP the server, start it again
// and check the record is still there. Uses a temporary database file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const serverFile = path.join(__dirname, '..', 'src', 'server.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port, databasePath) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath, NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  return child;
}

async function waitUntilReady(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch (err) { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start in time');
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
}

test('data survives a server restart', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internship-persist-test-'));
  const databasePath = path.join(tempDir, 'persist.db');
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}/api`;
  let child;

  try {
    // First run: create an internship and an application
    child = startServer(port, databasePath);
    await waitUntilReady(port);

    const created = await fetch(`${base}/internships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'INT-PERSIST', title: 'Persistence Intern', domain: 'Testing', mode: 'Remote',
        location: 'India', skills: ['SQLite'], openings: 1,
      }),
    });
    assert.equal(created.status, 201);

    // Delete a seed record too, to prove seeding does not bring it back after a restart.
    const deleted = await fetch(`${base}/internships/INT-105`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);

    await stopServer(child);

    // Second run: same database file
    child = startServer(port, databasePath);
    await waitUntilReady(port);

    const fetched = await fetch(`${base}/internships/INT-PERSIST`);
    assert.equal(fetched.status, 200);
    const body = await fetched.json();
    assert.equal(body.data.title, 'Persistence Intern');

    const list = await (await fetch(`${base}/internships?limit=100`)).json();
    assert.equal(list.pagination.total, 5); // 5 seed + 1 created - 1 deleted
    const seedAgain = await fetch(`${base}/internships/INT-105`);
    assert.equal(seedAgain.status, 404, 'a deleted seed record must not reappear after restart');
  } finally {
    if (child) await stopServer(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
