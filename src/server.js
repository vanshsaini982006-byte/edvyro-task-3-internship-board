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

const app = createApp();

// Only start listening when this file is run directly (npm start), not when tests import it.
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`Internship Board running at http://localhost:${port}`);
    console.log(`API base URL: http://localhost:${port}/api`);
  });

  const shutdown = () => {
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
