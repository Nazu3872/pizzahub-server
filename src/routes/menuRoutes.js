const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
  createMenuItem,
  getVendorMenuItems,
  getVendorMenuItemById,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  getPublicMenuItems,
  getFeaturedMenuItems,
  getPublicMenuItemById,
} = require('../controllers/menuController');

const router = express.Router();

// ============================================================================
// PUBLIC ROUTES (No Auth Required)
// ============================================================================
router.get('/menu-items/featured', getFeaturedMenuItems);
router.get('/menu-items', getPublicMenuItems);
router.get('/menu-items/:id', getPublicMenuItemById);

// ============================================================================
// VENDOR ROUTES (verifyJWT + vendor role + ownership enforced)
// ============================================================================
router.post('/vendor/menu-items', verifyJWT, requireRole('vendor'), createMenuItem);
router.get('/vendor/menu-items', verifyJWT, requireRole('vendor'), getVendorMenuItems);
router.get('/vendor/menu-items/:id', verifyJWT, requireRole('vendor'), getVendorMenuItemById);
router.put('/vendor/menu-items/:id', verifyJWT, requireRole('vendor'), updateMenuItem);
router.delete('/vendor/menu-items/:id', verifyJWT, requireRole('vendor'), deleteMenuItem);
router.patch('/vendor/menu-items/:id/availability', verifyJWT, requireRole('vendor'), toggleMenuItemAvailability);

module.exports = router;
