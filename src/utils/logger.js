'use strict';

// A tiny structured logger. No dependency needed for this project's size.
//   LOG_LEVEL:  debug | info | warn | error | silent   (default: info, or silent when NODE_ENV=test)
//   LOG_FORMAT: json | text                            (default: json in production, text otherwise)
//
// Rule for every caller: log identifiers and numbers only. Never pass applicant names,
// emails, resume links, cover letters or request bodies into a log call.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Removes line breaks and other control characters so a request path can never forge extra log lines.
function clean(value, maxLength = 200) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, maxLength);
}

function createLogger({ level = 'info', format = 'text', write } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const output = write || ((line, severity) => (severity === 'error' ? console.error(line) : console.log(line)));

  function log(severity, message, fields = {}) {
    if (LEVELS[severity] < threshold) return;
    const time = new Date().toISOString();
    if (format === 'json') {
      output(JSON.stringify({ time, level: severity, msg: message, ...fields }), severity);
      return;
    }
    const details = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${typeof value === 'string' && /\s/.test(value) ? JSON.stringify(value) : value}`)
      .join(' ');
    output(`${time} ${severity.toUpperCase().padEnd(5)} ${message}${details ? ' ' + details : ''}`, severity);
  }

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}

function loggerFromEnv(env = process.env) {
  const isTest = env.NODE_ENV === 'test';
  const level = (env.LOG_LEVEL || (isTest ? 'silent' : 'info')).toLowerCase();
  const format = (env.LOG_FORMAT || (env.NODE_ENV === 'production' ? 'json' : 'text')).toLowerCase();
  return createLogger({ level: level in LEVELS ? level : 'info', format: format === 'json' ? 'json' : 'text' });
}

module.exports = { createLogger, loggerFromEnv, clean, LEVELS };
