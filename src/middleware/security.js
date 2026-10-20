'use strict';

const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { sendError } = require('../utils/response');

// Secure response headers. The page only loads its own CSS and JS, so the policy is strict:
// no inline scripts, no inline styles, no third-party hosts.
function securityHeaders(config) {
  const connectSrc = ["'self'"];
  if (config.publicApiBaseUrl) connectSrc.push(config.publicApiBaseUrl);

  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc,
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Only force HTTPS upgrades in production; it breaks plain http://localhost in some browsers.
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

// Tells the browser this site never needs the camera, microphone, location and similar features,
// so injected or embedded code could not use them either.
function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
}

// CORS: with no CORS_ORIGIN set, no cross-origin access is granted at all.
function corsPolicy(config) {
  if (config.corsOrigins.length === 0) return (req, res, next) => next();
  return cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });
}

function makeLimiter(max, windowMs, message) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7', // adds RateLimit-* and Retry-After headers
    legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'RATE_LIMITED', message),
  });
}

// Broad limit for the whole API, stricter limit for application submissions.
function apiLimiter(config) {
  return makeLimiter(config.rateLimit.apiMax, config.rateLimit.windowMs, 'Too many requests. Please wait a while and try again.');
}

function applicationLimiter(config) {
  return makeLimiter(
    config.rateLimit.applicationMax,
    config.rateLimit.windowMs,
    'Too many applications submitted. Please wait a while before trying again.'
  );
}

// Requests that carry a body must be JSON. Anything else gets 415 instead of a confusing 400.
function requireJsonBody(req, res, next) {
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is('application/json')) {
    return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  next();
}

module.exports = { permissionsPolicy, securityHeaders, corsPolicy, apiLimiter, applicationLimiter, requireJsonBody };
