const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
  createCheckoutSession,
  getSubscriptionStatus,
  getAdminTransactions,
} = require('../controllers/subscriptionController');

const router = express.Router();

// ============================================================================
// VENDOR SUBSCRIPTION ROUTES
// ============================================================================
router.post('/subscription/checkout', verifyJWT, requireRole('vendor'), createCheckoutSession);
router.get('/subscription/status', verifyJWT, requireRole('vendor'), getSubscriptionStatus);

// ============================================================================
// ADMIN TRANSACTION ROUTES (Read-only GET; no PUT/PATCH/DELETE)
// ============================================================================
router.get('/admin/transactions', verifyJWT, requireRole('admin'), getAdminTransactions);

module.exports = router;
