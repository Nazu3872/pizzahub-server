const express = require('express');
const helmet = require('helmet');
const corsMiddleware = require('./middleware/cors');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(corsMiddleware);

// ============================================================================
// STRIPE WEBHOOK ROUTE (express.raw BEFORE express.json)
// IMPORTANT: Keep this placeholder untouched until Step 10 (Stripe integration).
// Stripe requires the raw, unparsed request body to verify cryptographic signatures.
// ----------------------------------------------------------------------------
// app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
// ============================================================================

// Body parsers for standard JSON API endpoints
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Core routes
app.use('/', healthRoutes);
app.use('/api', healthRoutes); // Support both root and /api prefixes
app.use('/api', authRoutes);

// 404 Catch-all handler
app.use(notFoundHandler);

// Central error handler
app.use(errorHandler);

module.exports = app;
