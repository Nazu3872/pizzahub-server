const config = require('../config/env');

/**
 * 404 Not Found JSON Handler
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Central Error Handler
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);

  let message = err.message || 'Internal Server Error';
  if (message.includes('SSL alert number 80') || message.includes('ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR')) {
    message = 'MongoDB Atlas rejected connection (IP Access List restriction). Please add 0.0.0.0/0 or your current IP to MongoDB Atlas Network Access.';
  }

  const response = {
    success: false,
    message,
  };

  // Provide stack trace only in non-production environments
  if (config.nodeEnv !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
