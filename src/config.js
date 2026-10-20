'use strict';

// Reads runtime settings from environment variables, with safe defaults.
// Tests run with very high rate limits so they never fail by accident;
// the rate-limit tests pass their own small limits to createApp() instead.

function toInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

// An origin looks like https://example.com (no path). Anything else is ignored.
function toOrigin(value) {
  if (!value || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch (err) {
    return '';
  }
}

function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';
  const open = 1000000;

  return {
    isProduction,
    isTest,
    // Frontend origins allowed to call the API from another site (comma separated).
    // Empty = same-origin only, which is how this project normally runs.
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map(toOrigin).filter(Boolean),
    // Where the browser should send API calls. Empty = same server ("/api").
    publicApiBaseUrl: toOrigin(env.PUBLIC_API_BASE_URL),
    // Number of reverse proxies in front of the app (0 = none). Needed for correct client IPs.
    trustProxy: Number.parseInt(env.TRUST_PROXY, 10) > 0 ? Number.parseInt(env.TRUST_PROXY, 10) : 0,
    // How long browsers may reuse CSS/JS without asking again (seconds). 0 = always revalidate.
    staticMaxAgeSeconds: toInt(env.STATIC_MAX_AGE_SECONDS, isProduction ? 300 : 0),
    rateLimit: {
      windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      apiMax: toInt(env.RATE_LIMIT_API_MAX, isTest ? open : 300),
      applicationMax: toInt(env.RATE_LIMIT_APPLICATION_MAX, isTest ? open : 10),
    },
  };
}

module.exports = { loadConfig };
