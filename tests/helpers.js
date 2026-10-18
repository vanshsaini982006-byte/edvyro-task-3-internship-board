'use strict';

// Shared test helpers: start an app on a random port against a throw-away database.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTempDatabasePath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, file: path.join(dir, 'test.db') };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, method, urlPath, { body, rawBody, headers = {} } = {}) {
  const options = { method, headers: { ...headers } };
  if (rawBody !== undefined) {
    options.body = rawBody;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + urlPath, options);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* not JSON */ }
  return { status: response.status, headers: response.headers, body: json, text };
}

module.exports = { makeTempDatabasePath, listen, close, request, fs };
