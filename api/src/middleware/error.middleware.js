// src/middleware/error.middleware.js

/**
 * Central error handler — must be registered last in Express
 */
function errorHandler(err, req, res, next) {
  // Structured errors thrown by services
  if (err.status && err.code) {
    return res.status(err.status).json({
      code: err.code,
      message: err.message,
    });
  }

  // PostgreSQL errors
  if (err.code && err.code.startsWith('23')) {
    const pgErrors = {
      '23505': { status: 409, code: 'DUPLICATE', message: 'A record with this value already exists' },
      '23503': { status: 400, code: 'FOREIGN_KEY', message: 'Referenced record does not exist' },
      '23514': { status: 400, code: 'CHECK_VIOLATION', message: err.message },
      '23P01': { status: 400, code: 'EXCLUSION_VIOLATION', message: err.message },
    };
    const mapped = pgErrors[err.code];
    if (mapped) return res.status(mapped.status).json(mapped);
  }

  // PostgreSQL raise_exception from triggers
  if (err.code === 'P0001') {
    return res.status(400).json({
      code: 'BUSINESS_RULE_VIOLATION',
      message: err.message,
    });
  }

  // Unexpected errors — log and return generic message
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}

/**
 * 404 handler — register before errorHandler
 */
function notFound(req, res) {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = { errorHandler, notFound };
