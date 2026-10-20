'use strict';

const { sendError, ApiError } = require('../utils/response');
const { loggerFromEnv, clean } = require('../utils/logger');

const fallbackLogger = loggerFromEnv();

// Any request that did not match a route.
function notFoundHandler(req, res) {
  sendError(res, 404, 'ROUTE_NOT_FOUND', 'API route not found');
}

// Express recognises this as the error handler because it has four arguments.
// Users only ever see a safe message: no stack traces, no SQL, no file paths.
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Errors we throw on purpose (validation, not found, duplicates ...).
  if (err instanceof ApiError) {
    return sendError(res, err.status, err.code, err.message, err.fields);
  }

  // Problems reading the request body. Handled BEFORE any logging because these
  // error objects can carry the raw request body (which may hold applicant details).
  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (err && err.type === 'entity.too.large') {
    return sendError(res, 400, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err && err.type && err.status >= 400 && err.status < 500) {
    return sendError(res, 400, 'INVALID_REQUEST', 'The request could not be processed');
  }

  // Anything else is a bug or a database problem: log it for the developer, hide it from the user.
  // Only the error name, message and a short stack are logged - never the request body or the error object itself.
  const logger = (req.app && req.app.locals.logger) || fallbackLogger;
  logger.error('unhandled error', {
    requestId: req.id,
    method: req.method,
    path: clean(req.originalUrl.split('?')[0]),
    errorName: err && err.name ? clean(err.name, 80) : 'UnknownError',
    errorCode: err && err.code ? clean(err.code, 80) : undefined,
    message: clean(err && err.message ? err.message : String(err), 300),
    stack: err && err.stack ? clean(String(err.stack).split('\n').slice(0, 6).join(' | '), 1200) : undefined,
  });
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}

module.exports = { notFoundHandler, errorHandler };
