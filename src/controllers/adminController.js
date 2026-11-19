const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');

// Helper: parse ObjectId safely
function parseObjectId(id) {
  if (!id || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

/**
 * GET /api/admin/stats
 * Aggregated platform metrics and overview stats
 */
async function getPlatformStats(req, res) {
  try {
    const db = getDB();
    const usersCollection = db.collection('user');
    const menuCollection = db.collection('menuItems');
    const transactionsCollection = db.collection('transactions');
    const ordersCollection = db.collection('orders');

    // Parallel count queries and revenue aggregation
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalAdmins,
      totalMenuItems,
      pendingMenuItems,
      approvedMenuItems,
      totalTransactions,
      revenueResult,
      totalOrders,
    ] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: 'vendor' }),
      usersCollection.countDocuments({ role: 'customer' }),
      usersCollection.countDocuments({ role: 'admin' }),
      menuCollection.countDocuments({}),
      menuCollection.countDocuments({ status: 'pending' }),
      menuCollection.countDocuments({ status: 'approved' }),
      transactionsCollection.countDocuments({}),
      transactionsCollection
        .aggregate([
          { $match: { status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .toArray(),
      ordersCollection.countDocuments({}),
    ]);

    const totalRevenue = revenueResult?.[0]?.total || 0;

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalAdmins,
        totalMenuItems,
        pendingMenuItems,
        approvedMenuItems,
        totalTransactions,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalOrders,
      },
    });
  } catch (error) {
    console.error('Error fetching admin platform stats:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch stats: ${error.message}`,
    });
  }
}

/**
 * GET /api/admin/users
 * Search and filter platform users
 */
async function getAdminUsers(req, res) {
  try {
    const { search, role, page = 1, limit = 50 } = req.query;
    const db = getDB();
    const usersCollection = db.collection('user');

    const query = {};

    // Role filter
    if (role && role !== 'all') {
      query.role = role;
    }

    // Search by name or email
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex }, { email: regex }, { businessName: regex }];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [users, total] = await Promise.all([
      usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .project({
          id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          businessName: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          image: 1,
          createdAt: 1,
        })
        .toArray(),
      usersCollection.countDocuments(query),
    ]);

    const formattedUsers = users.map((u) => ({
      id: u.id || u._id.toString(),
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role || 'customer',
      isBlocked: Boolean(u.isBlocked),
      businessName: u.businessName,
      subscriptionPlan: u.subscriptionPlan || 'free',
      subscriptionExpiresAt: u.subscriptionExpiresAt,
      image: u.image || '',
      createdAt: u.createdAt,
    }));

    return res.status(200).json({
      success: true,
      data: formattedUsers,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch users: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/admin/users/:id/block
 * Block a user account.
 * Rules:
 * - Admin cannot block themselves
 * - Admin cannot block other admins
 * - Takes effect immediately on all protected APIs
 */
async function blockUser(req, res) {
  try {
    const targetId = req.params.id;
    const currentAdminId = req.user.id;
    const db = getDB();
    const usersCollection = db.collection('user');

    // Rule 1: Admin cannot block themselves
    if (targetId === currentAdminId) {
      return res.status(400).json({
        success: false,
        message: 'Administrators cannot block their own account.',
      });
    }

    const query = [{ id: targetId }];
    if (ObjectId.isValid(targetId)) {
      query.push({ _id: new ObjectId(targetId) });
    }

    const targetUser = await usersCollection.findOne({ $or: query });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if double target ID matches admin's internal ID
    if (targetUser.id === currentAdminId || targetUser._id.toString() === currentAdminId) {
      return res.status(400).json({
        success: false,
        message: 'Administrators cannot block their own account.',
      });
    }

    // Rule 2: Admin cannot block other admins
    if (targetUser.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Administrators cannot block other administrator accounts.',
      });
    }

    // Apply immediate block
    await usersCollection.updateOne(
      { _id: targetUser._id },
      {
        $set: {
          isBlocked: true,
          blockedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: `Account for ${targetUser.name} (${targetUser.email}) has been blocked immediately.`,
      data: {
        id: targetUser.id || targetUser._id.toString(),
        isBlocked: true,
      },
    });
  } catch (error) {
    console.error('Error in blockUser:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to block user: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/admin/users/:id/unblock
 * Unblock a previously suspended user account
 */
async function unblockUser(req, res) {
  try {
    const targetId = req.params.id;
    const db = getDB();
    const usersCollection = db.collection('user');

    const query = [{ id: targetId }];
    if (ObjectId.isValid(targetId)) {
      query.push({ _id: new ObjectId(targetId) });
    }

    const targetUser = await usersCollection.findOne({ $or: query });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await usersCollection.updateOne(
      { _id: targetUser._id },
      {
        $set: {
          isBlocked: false,
          unblockedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: `Account for ${targetUser.name} (${targetUser.email}) has been unblocked.`,
      data: {
        id: targetUser.id || targetUser._id.toString(),
        isBlocked: false,
      },
    });
  } catch (error) {
    console.error('Error in unblockUser:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to unblock user: ${error.message}`,
    });
  }
}

/**
 * GET /api/admin/menu-items
 * Moderation list for all menu items with search, status, and category filters
 */
async function getAdminMenuItems(req, res) {
  try {
    const { search, status, category, page = 1, limit = 50 } = req.query;
    const db = getDB();
    const menuCollection = db.collection('menuItems');
    const usersCollection = db.collection('user');

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (category && category !== 'all') {
      query.category = category;
    }

    if (search && search.trim()) {
      query.itemName = new RegExp(search.trim(), 'i');
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [items, total] = await Promise.all([
      menuCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .toArray(),
      menuCollection.countDocuments(query),
    ]);

    // Enrich with vendor details
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        let vendor = { name: 'Artisan Kitchen', businessName: 'Pizzeria', email: '' };
        try {
          const vendorUser = await usersCollection.findOne({
            $or: [
              { id: item.vendorId },
              ...(ObjectId.isValid(item.vendorId) ? [{ _id: new ObjectId(item.vendorId) }] : []),
            ],
          });
          if (vendorUser) {
            vendor = {
              name: vendorUser.name,
              businessName: vendorUser.businessName || vendorUser.name,
              email: vendorUser.email,
              subscriptionPlan: vendorUser.subscriptionPlan || 'free',
            };
          }
        } catch (e) {}

        return {
          id: item._id.toString(),
          _id: item._id.toString(),
          vendorId: item.vendorId,
          itemName: item.itemName,
          category: item.category,
          description: item.description,
          price: item.price,
          location: item.location,
          images: item.images || [],
          status: item.status,
          isActive: item.isActive !== false,
          vendor,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enrichedItems,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Error fetching admin menu items:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch menu items: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/admin/menu-items/:id/status
 * Moderate menu item: approve, reject, or toggle published status (approved <-> inactive)
 */
async function updateMenuItemStatus(req, res) {
  try {
    const itemId = parseObjectId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Invalid menu item ID' });
    }

    const { status } = req.body;
    const allowedStatuses = ['approved', 'rejected', 'inactive', 'pending'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`,
      });
    }

    const db = getDB();
    const menuCollection = db.collection('menuItems');

    const updateDoc = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'approved') {
      updateDoc.isActive = true;
      updateDoc.approvedAt = new Date();
    } else if (status === 'inactive') {
      updateDoc.isActive = false;
    } else if (status === 'rejected') {
      updateDoc.rejectedAt = new Date();
    }

    const result = await menuCollection.findOneAndUpdate(
      { _id: itemId },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Menu item status updated to "${status}".`,
      data: {
        id: result._id.toString(),
        status: result.status,
        isActive: result.isActive,
      },
    });
  } catch (error) {
    console.error('Error updating menu item status:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to update status: ${error.message}`,
    });
  }
}

/**
 * DELETE /api/admin/menu-items/:id
 * Delete inappropriate menu item
 */
async function deleteAdminMenuItem(req, res) {
  try {
    const itemId = parseObjectId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Invalid menu item ID' });
    }

    const db = getDB();
    const menuCollection = db.collection('menuItems');

    const deleteResult = await menuCollection.deleteOne({ _id: itemId });
    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Menu item deleted permanently.',
    });
  } catch (error) {
    console.error('Error deleting menu item by admin:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to delete menu item: ${error.message}`,
    });
  }
}

/**
 * GET /api/admin/transactions
 * Read-only list of platform transactions enriched with vendor details
 */
async function getAdminTransactions(req, res) {
  try {
    const db = getDB();
    const transactionsCollection = db.collection('transactions');
    const usersCollection = db.collection('user');

    const transactions = await transactionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const enrichedTransactions = await Promise.all(
      transactions.map(async (tx) => {
        let vendor = { name: 'Vendor', businessName: 'Artisan Kitchen', email: '' };
        try {
          const vendorUser = await usersCollection.findOne({
            $or: [
              { id: tx.vendorId },
              ...(ObjectId.isValid(tx.vendorId) ? [{ _id: new ObjectId(tx.vendorId) }] : []),
            ],
          });
          if (vendorUser) {
            vendor = {
              name: vendorUser.name,
              businessName: vendorUser.businessName || vendorUser.name,
              email: vendorUser.email,
            };
          }
        } catch (e) {}

        return {
          id: tx._id.toString(),
          _id: tx._id.toString(),
          vendorId: tx.vendorId,
          plan: tx.plan,
          amount: tx.amount,
          currency: tx.currency,
          stripeSessionId: tx.stripeSessionId,
          stripeSubscriptionId: tx.stripeSubscriptionId,
          status: tx.status,
          vendor,
          createdAt: tx.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enrichedTransactions,
    });
  } catch (error) {
    console.error('Error fetching admin transactions:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch transactions: ${error.message}`,
    });
  }
}

module.exports = {
  getPlatformStats,
  getAdminUsers,
  blockUser,
  unblockUser,
  getAdminMenuItems,
  updateMenuItemStatus,
  deleteAdminMenuItem,
  getAdminTransactions,
};
