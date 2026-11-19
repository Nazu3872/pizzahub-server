const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');

/**
 * GET /api/me
 * Protected user profile endpoint
 */
function getMe(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
}

/**
 * PATCH /api/users/profile & PATCH /api/me
 * Update authenticated user profile with strict field WHITELIST.
 * Security: role, isBlocked, subscriptionPlan, subscriptionExpiresAt, email CANNOT be changed.
 */
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const { name, image, businessName, role, isBlocked, subscriptionPlan, subscriptionExpiresAt, email } = req.body;

    // Detect and reject privilege escalation tampering attempts
    if (role !== undefined || isBlocked !== undefined || subscriptionPlan !== undefined || subscriptionExpiresAt !== undefined || email !== undefined) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Modifying role, email, block status, or subscription plan via profile update is strictly prohibited.',
      });
    }

    // Strict field WHITELIST: only allow name, image, and businessName (vendor)
    const updateDoc = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be a valid string of at least 2 characters.',
        });
      }
      updateDoc.name = name.trim();
    }

    if (image !== undefined) {
      if (image === '' || (typeof image === 'string' && image.startsWith('http'))) {
        updateDoc.image = image.trim();
      } else {
        return res.status(400).json({
          success: false,
          message: 'Image must be a valid URL string or empty.',
        });
      }
    }

    if (businessName !== undefined) {
      if (req.user.role === 'vendor') {
        if (typeof businessName !== 'string' || businessName.trim().length < 2) {
          return res.status(400).json({
            success: false,
            message: 'Business name must be at least 2 characters.',
          });
        }
        updateDoc.businessName = businessName.trim();
      }
    }

    if (Object.keys(updateDoc).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid whitelisted fields provided to update.',
      });
    }

    updateDoc.updatedAt = new Date();

    const db = getDB();
    const usersCollection = db.collection('user');

    const query = [{ id: userId.toString() }];
    if (ObjectId.isValid(userId)) {
      query.push({ _id: new ObjectId(userId) });
    }

    const result = await usersCollection.findOneAndUpdate(
      { $or: query },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'User account not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        id: result.id || result._id.toString(),
        name: result.name,
        email: result.email,
        role: result.role,
        image: result.image || '',
        businessName: result.businessName || '',
        subscriptionPlan: result.subscriptionPlan || 'free',
        subscriptionExpiresAt: result.subscriptionExpiresAt || null,
        isBlocked: Boolean(result.isBlocked),
      },
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to update profile: ${error.message}`,
    });
  }
}

/**
 * GET /api/vendor/stats
 * Aggregated statistics and chart data for vendor dashboard
 */
async function getVendorStats(req, res) {
  try {
    const vendorId = req.user.id.toString();
    const db = getDB();
    const menuCollection = db.collection('menuItems');
    const ordersCollection = db.collection('orders');

    const [
      totalItems,
      activeItems,
      approvedItems,
      pendingItems,
      totalOrders,
      pendingOrders,
      acceptedOrders,
      rejectedOrders,
      cancelledOrders,
    ] = await Promise.all([
      menuCollection.countDocuments({ vendorId }),
      menuCollection.countDocuments({ vendorId, status: { $in: ['pending', 'approved'] } }),
      menuCollection.countDocuments({ vendorId, status: 'approved' }),
      menuCollection.countDocuments({ vendorId, status: 'pending' }),
      ordersCollection.countDocuments({ vendorId }),
      ordersCollection.countDocuments({ vendorId, status: 'pending' }),
      ordersCollection.countDocuments({ vendorId, status: 'accepted' }),
      ordersCollection.countDocuments({ vendorId, status: 'rejected' }),
      ordersCollection.countDocuments({ vendorId, status: 'cancelled' }),
    ]);

    // Sum revenue from accepted orders
    const revenueAgg = await ordersCollection
      .aggregate([
        { $match: { vendorId, status: 'accepted' } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } },
      ])
      .toArray();

    const totalRevenue = revenueAgg?.[0]?.total || 0;

    // Chart dataset for Recharts: Order Status Breakdown
    const orderStatusChart = [
      { name: 'Pending Review', count: pendingOrders, fill: '#f59e0b' },
      { name: 'Accepted', count: acceptedOrders, fill: '#10b981' },
      { name: 'Rejected', count: rejectedOrders, fill: '#ef4444' },
      { name: 'Cancelled', count: cancelledOrders, fill: '#71717a' },
    ];

    // Chart dataset: Catalog Status Breakdown
    const catalogChart = [
      { name: 'Approved', count: approvedItems, fill: '#10b981' },
      { name: 'Pending', count: pendingItems, fill: '#f59e0b' },
      { name: 'Other', count: Math.max(0, totalItems - approvedItems - pendingItems), fill: '#71717a' },
    ];

    return res.status(200).json({
      success: true,
      data: {
        totalItems,
        activeItems,
        approvedItems,
        pendingItems,
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        subscriptionPlan: req.user.subscriptionPlan || 'free',
        subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
        orderStatusChart,
        catalogChart,
      },
    });
  } catch (error) {
    console.error('Error fetching vendor stats:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch vendor statistics: ${error.message}`,
    });
  }
}

/**
 * GET /api/customer/stats
 * Aggregated statistics and chart data for customer dashboard
 */
async function getCustomerStats(req, res) {
  try {
    const customerId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');

    const [
      totalOrders,
      pendingOrders,
      acceptedOrders,
      rejectedOrders,
      cancelledOrders,
    ] = await Promise.all([
      ordersCollection.countDocuments({ customerId }),
      ordersCollection.countDocuments({ customerId, status: 'pending' }),
      ordersCollection.countDocuments({ customerId, status: 'accepted' }),
      ordersCollection.countDocuments({ customerId, status: 'rejected' }),
      ordersCollection.countDocuments({ customerId, status: 'cancelled' }),
    ]);

    // Calculate customer total spending
    const spendAgg = await ordersCollection
      .aggregate([
        { $match: { customerId, status: { $in: ['pending', 'accepted'] } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } },
      ])
      .toArray();

    const totalSpent = spendAgg?.[0]?.total || 0;

    const ordersChart = [
      { name: 'Pending', count: pendingOrders, fill: '#f59e0b' },
      { name: 'Accepted & Baking', count: acceptedOrders, fill: '#10b981' },
      { name: 'Rejected', count: rejectedOrders, fill: '#ef4444' },
      { name: 'Cancelled', count: cancelledOrders, fill: '#71717a' },
    ];

    return res.status(200).json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
        totalSpent: Number(totalSpent.toFixed(2)),
        ordersChart,
      },
    });
  } catch (error) {
    console.error('Error fetching customer stats:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch customer statistics: ${error.message}`,
    });
  }
}

function testVendorOnly(req, res) {
  return res.status(200).json({
    success: true,
    message: `Access granted to vendor area for ${req.user.name} (${req.user.businessName || 'Kitchen'})`,
    user: req.user,
  });
}

function testAdminOnly(req, res) {
  return res.status(200).json({
    success: true,
    message: `Access granted to administrator panel for ${req.user.email}`,
    user: req.user,
  });
}

module.exports = {
  getMe,
  updateProfile,
  getVendorStats,
  getCustomerStats,
  testVendorOnly,
  testAdminOnly,
};
