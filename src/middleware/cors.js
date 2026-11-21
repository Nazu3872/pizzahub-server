const cors = require('cors');
const config = require('../config/env');

const allowedOrigins = new Set();

if (config.clientUrl) {
  // Support comma-separated URLs in CLIENT_URL
  config.clientUrl.split(',').forEach((url) => {
    if (url && url.trim()) {
      allowedOrigins.add(url.trim().replace(/\/$/, ''));
    }
  });
}

// Always allow local development URLs
allowedOrigins.add('http://localhost:3000');
allowedOrigins.add('http://127.0.0.1:3000');

const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser requests (like curl, health checks, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/$/, '');

    // Allow explicitly configured origins or any Vercel deployment domain
    if (
      allowedOrigins.has(normalizedOrigin) ||
      normalizedOrigin.endsWith('.vercel.app')
    ) {
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
