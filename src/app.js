'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');
const { loadConfig } = require('./config');
const { db } = require('./db');
const internshipRoutes = require('./routes/internships');
const applicationRoutes = require('./routes/applications');
const { listDomains } = require('./controllers/internshipController');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { permissionsPolicy, securityHeaders, corsPolicy, apiLimiter, applicationLimiter, requireJsonBody } = require('./middleware/security');
const { requestLogger } = require('./middleware/requestLogger');
const { loggerFromEnv } = require('./utils/logger');
const { sendSuccess, sendError } = require('./utils/response');
const { version } = require('../package.json');

// GET /api/health: "is the app running AND can it reach its database?"
// It is mounted before the rate limiter on purpose: a hosting platform pings it all day from one
// address, and a limiter would eventually answer 429 and make a healthy service look dead.
function healthCheck(logger) {
  return (req, res) => {
    try {
      db.prepare('SELECT 1').get();
    } catch (err) {
      logger.error('health check failed', { requestId: req.id, errorName: err && err.name });
      res.set('Cache-Control', 'no-store');
      return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable');
    }
    res.set('Cache-Control', 'no-store');
    sendSuccess(res, { message: 'Internship API is running', database: 'ok', uptime_seconds: Math.round(process.uptime()), version });
  };
}

// API responses: GET may be reused only after the server confirms it is unchanged (ETag -> 304).
// Anything else (applications!) is never stored by browsers or proxies.
function apiCacheHeaders(req, res, next) {
  res.set('Cache-Control', req.method === 'GET' || req.method === 'HEAD' ? 'no-cache' : 'no-store');
  next();
}

// Builds the Express app. Tests can pass their own config (for example a tiny rate limit) or logger.
function createApp(config = loadConfig(), { logger = loggerFromEnv() } = {}) {
  const app = express();
  app.locals.logger = logger;
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(requestLogger(logger));
  app.use(securityHeaders(config));
  app.use(permissionsPolicy);
  app.use(compression());

  // Tells the browser which API address to use (empty = this same server).
  app.get('/config.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache');
    res.send(`window.APP_CONFIG = ${JSON.stringify({ apiBaseUrl: config.publicApiBaseUrl })};\n`);
  });

  app.get('/api/health', healthCheck(logger));

  app.use('/api', corsPolicy(config), apiLimiter(config), apiCacheHeaders, requireJsonBody, express.json({ limit: '10kb' }));

  app.get('/api/domains', listDomains);
  app.use('/api/internships', internshipRoutes);
  app.use('/api/applications', applicationLimiter(config), applicationRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.staticMaxAgeSeconds * 1000 }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
