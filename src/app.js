'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const internshipRoutes = require('./routes/internships');
const applicationRoutes = require('./routes/applications');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { securityHeaders, corsPolicy, apiLimiter, applicationLimiter, requireJsonBody } = require('./middleware/security');
const { sendSuccess } = require('./utils/response');

// Builds the Express app. Tests can pass their own config (for example a tiny rate limit).
function createApp(config = loadConfig()) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));

  // Minimal request log: method, path (no query string, no body) and status code.
  if (!config.isTest) {
    app.use((req, res, next) => {
      const requestPath = req.originalUrl.split('?')[0];
      res.on('finish', () => console.log(`${req.method} ${requestPath} ${res.statusCode}`));
      next();
    });
  }

  // Tells the browser which API address to use (empty = this same server).
  app.get('/config.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache');
    res.send(`window.APP_CONFIG = ${JSON.stringify({ apiBaseUrl: config.publicApiBaseUrl })};\n`);
  });

  app.use('/api', corsPolicy(config), apiLimiter(config), requireJsonBody, express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    sendSuccess(res, { message: 'Internship API is running' });
  });
  app.use('/api/internships', internshipRoutes);
  app.use('/api/applications', applicationLimiter(config), applicationRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
