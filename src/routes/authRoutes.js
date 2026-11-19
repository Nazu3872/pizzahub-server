const express = require('express');
const { verifyJWT, requireRole, blockIfBlocked } = require('../middleware/auth');
const { getMe, testVendorOnly, testAdminOnly } = require('../controllers/authController');

const router = express.Router();

// GET /api/me - Protected user profile endpoint
router.get('/me', verifyJWT, blockIfBlocked, getMe);

// GET /api/test/vendor-only - Protected vendor testing endpoint
router.get('/test/vendor-only', verifyJWT, blockIfBlocked, requireRole('vendor'), testVendorOnly);

// GET /api/test/admin-only - Protected admin testing endpoint
router.get('/test/admin-only', verifyJWT, blockIfBlocked, requireRole('admin'), testAdminOnly);

module.exports = router;
