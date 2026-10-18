'use strict';

// Every response in the API goes through these helpers, so the JSON shape never drifts.
//   success: { status: "success", data: ..., pagination?: ... }
//   error:   { status: "error", error: { code, message, fields? } }

function sendSuccess(res, data, options = {}) {
  const { status = 200, pagination } = options;
  const body = { status: 'success', data };
  if (pagination) {
    body.pagination = pagination;
  }
  return res.status(status).json(body);
}

function sendError(res, status, code, message, fields) {
  const error = { code, message };
  if (fields && Object.keys(fields).length > 0) {
    error.fields = fields;
  }
  return res.status(status).json({ status: 'error', error });
}

// Throw an ApiError anywhere in a controller or middleware.
// The central error handler turns it into a proper error response.
class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

module.exports = { sendSuccess, sendError, ApiError };
