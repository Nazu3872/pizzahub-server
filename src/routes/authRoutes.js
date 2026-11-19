const express = require('express');
const { verifyJWT, requireRole, blockIfBlocked } = require('../middleware/auth');
const {
  getMe,
  updateProfile,
  getVendorStats,
  getCustomerStats,
  testVendorOnly,
  testAdminOnly,
} = require('../controllers/authController');

const router = express.Router();

// GET /api/me - Protected user profile endpoint
router.get('/me', verifyJWT, blockIfBlocked, getMe);

// PATCH /api/users/profile & /api/me - Update profile with strict whitelist
router.patch('/users/profile', verifyJWT, blockIfBlocked, updateProfile);
router.patch('/me', verifyJWT, blockIfBlocked, updateProfile);

// GET /api/vendor/stats - Vendor dashboard aggregated data & charts
router.get('/vendor/stats', verifyJWT, blockIfBlocked, requireRole('vendor'), getVendorStats);

// GET /api/customer/stats - Customer dashboard aggregated data & charts
router.get('/customer/stats', verifyJWT, blockIfBlocked, requireRole('customer'), getCustomerStats);

// Testing endpoints
router.get('/test/vendor-only', verifyJWT, blockIfBlocked, requireRole('vendor'), testVendorOnly);
router.get('/test/admin-only', verifyJWT, blockIfBlocked, requireRole('admin'), testAdminOnly);

module.exports = router;
