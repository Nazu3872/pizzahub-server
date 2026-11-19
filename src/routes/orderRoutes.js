const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
  createOrder,
  getCustomerOrders,
  cancelCustomerOrder,
  getVendorOrders,
  acceptVendorOrder,
  rejectVendorOrder,
  getOrderById,
} = require('../controllers/orderController');

const router = express.Router();

// ============================================================================
// CUSTOMER ORDER ROUTES
// ============================================================================
router.post('/orders', verifyJWT, requireRole('customer'), createOrder);
router.get('/orders/customer', verifyJWT, requireRole('customer'), getCustomerOrders);
router.patch('/orders/:id/cancel', verifyJWT, requireRole('customer'), cancelCustomerOrder);

// ============================================================================
// VENDOR ORDER ROUTES
// ============================================================================
router.get('/orders/vendor', verifyJWT, requireRole('vendor'), getVendorOrders);
router.patch('/orders/:id/accept', verifyJWT, requireRole('vendor'), acceptVendorOrder);
router.patch('/orders/:id/reject', verifyJWT, requireRole('vendor'), rejectVendorOrder);

// ============================================================================
// SHARED / DETAILS ROUTE (Customer, Vendor, Admin)
// ============================================================================
router.get('/orders/:id', verifyJWT, getOrderById);

module.exports = router;
