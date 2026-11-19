const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
  getPlatformStats,
  getAdminUsers,
  blockUser,
  unblockUser,
  getAdminMenuItems,
  updateMenuItemStatus,
  deleteAdminMenuItem,
  getAdminTransactions,
} = require('../controllers/adminController');

const router = express.Router();

// Enforce admin role and valid JWT across ALL admin routes
router.use(verifyJWT);
router.use(requireRole('admin'));

// ============================================================================
// 1. PLATFORM OVERVIEW STATS
// ============================================================================
router.get('/admin/stats', getPlatformStats);

// ============================================================================
// 2. USER MANAGEMENT
// ============================================================================
router.get('/admin/users', getAdminUsers);
router.patch('/admin/users/:id/block', blockUser);
router.patch('/admin/users/:id/unblock', unblockUser);

// ============================================================================
// 3. MENU ITEM MODERATION
// ============================================================================
router.get('/admin/menu-items', getAdminMenuItems);
router.patch('/admin/menu-items/:id/status', updateMenuItemStatus);
router.delete('/admin/menu-items/:id', deleteAdminMenuItem);

// ============================================================================
// 4. TRANSACTIONS (Strictly READ-ONLY GET; NO PUT/PATCH/DELETE exist)
// ============================================================================
router.get('/admin/transactions', getAdminTransactions);

module.exports = router;
