'use strict';

const path = require('path');

// Load optional settings from a .env file (built into Node 22 - no extra package).
// Values already set in the environment win over the file.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  // No .env file is fine: the defaults below are used.
}

const { closeDatabase } = require('./db');
const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { loggerFromEnv } = require('./utils/logger');

const logger = loggerFromEnv();
const config = loadConfig();
const app = createApp(config, { logger });

// Only start listening when this file is run directly (npm start), not when tests import it.
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    // Settings only; no secrets or personal data.
    logger.info('server started', {
      port,
      nodeEnv: process.env.NODE_ENV || 'development',
      node: process.versions.node,
      trustProxy: config.trustProxy,
      corsOrigins: config.corsOrigins.length,
      apiRateLimit: config.rateLimit.apiMax,
      applicationRateLimit: config.rateLimit.applicationMax,
      rateLimitWindowMs: config.rateLimit.windowMs,
    });
    logger.info('open the app', { url: `http://localhost:${port}`, health: `http://localhost:${port}/api/health` });
  });

  // A crash should leave a clear, safe log line before the process exits (the host then restarts it).
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { errorName: err && err.name, message: err && err.message });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { message: reason && reason.message ? reason.message : String(reason) });
    process.exit(1);
  });

  const shutdown = () => {
    logger.info('shutting down');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
