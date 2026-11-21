const express = require('express');
const helmet = require('helmet');
const corsMiddleware = require('./middleware/cors');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { connectDB } = require('./db/connection');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { handleStripeWebhook } = require('./controllers/webhookController');

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(corsMiddleware);

// ============================================================================
// STRIPE WEBHOOK ROUTE (express.raw BEFORE express.json)
// Stripe requires the raw, unparsed request body to verify cryptographic signatures.
// Support both /api/stripe/webhook and /api/webhooks/stripe endpoints.
// ----------------------------------------------------------------------------
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
// ============================================================================

// Body parsers for standard JSON API endpoints
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure Database connection for incoming API requests
app.use(async (req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// Core routes - Support both root and /api prefixes seamlessly
app.use('/', healthRoutes);
app.use('/api', healthRoutes);

app.use('/', authRoutes);
app.use('/api', authRoutes);

app.use('/', menuRoutes);
app.use('/api', menuRoutes);

app.use('/', orderRoutes);
app.use('/api', orderRoutes);

app.use('/', subscriptionRoutes);
app.use('/api', subscriptionRoutes);

app.use('/', adminRoutes);
app.use('/api', adminRoutes);

// 404 Catch-all handler
app.use(notFoundHandler);

// Central error handler
app.use(errorHandler);

module.exports = app;
