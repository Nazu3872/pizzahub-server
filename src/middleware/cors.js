const cors = require('cors');
const config = require('../config/env');

const allowedOrigins = new Set();

if (config.clientUrl) {
  // Trim trailing slash if present
  allowedOrigins.add(config.clientUrl.replace(/\/$/, ''));
}

// In development or preview environments, allow local development ports
if (config.nodeEnv !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://127.0.0.1:3000');
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser requests (like curl, health checks, or mobile apps without Origin header)
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.has(normalizedOrigin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, // 24 hours preflight cache
};

module.exports = cors(corsOptions);
