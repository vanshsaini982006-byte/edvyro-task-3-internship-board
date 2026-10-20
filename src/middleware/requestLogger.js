'use strict';

const crypto = require('crypto');
const { clean } = require('../utils/logger');

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SLOW_REQUEST_MS = 1000;

// Gives every request an ID (so a user-reported problem can be found in the logs), and logs one line
// when the response finishes: method, route, status and how long it took.
// Not logged: query string, headers, body, IP address.
function requestLogger(logger) {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);

    const startedAt = process.hrtime.bigint();
    const path = clean(req.originalUrl.split('?')[0]); // captured now, before routers change req.url

    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100; // 2 decimals
      // route = the pattern that matched (/api/internships/:id), which keeps logs easy to group.
      const route = req.route ? clean(`${req.baseUrl || ''}${req.route.path}`) : undefined;
      const fields = { requestId: req.id, method: req.method, path, route, status: res.statusCode, ms };

      if (res.statusCode >= 500) logger.error('request', fields);
      else if (ms >= SLOW_REQUEST_MS) logger.warn('slow request', fields);
      else if (path === '/api/health' && res.statusCode < 400) logger.debug('request', fields); // keep health pings quiet
      else logger.info('request', fields);
    });
    next();
  };
}

module.exports = { requestLogger };
