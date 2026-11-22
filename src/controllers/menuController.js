const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');

const ALLOWED_CATEGORIES = [
  'Classic Pizzas',
  'Vegetarian Pizzas',
  'Meat Lovers',
  'Specialty / Gourmet Pizzas',
  'Sides & Appetizers',
  'Beverages & Desserts',
];

/**
 * Free plan limit rule:
 * Interpretation: Active items are defined as any item with status "pending" or "approved".
 * Free plan vendors are limited to a maximum of 10 active items simultaneously.
 */
const FREE_PLAN_MAX_ACTIVE_ITEMS = 10;

// Helper: validate ObjectId
function parseObjectId(id) {
  if (!id || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

// ============================================================================
// VENDOR CONTROLLERS
// ============================================================================

/**
 * POST /api/vendor/menu-items
 * Create a new menu item for the authenticated vendor
 */
async function createMenuItem(req, res) {
  try {
    const {
      itemName,
      category,
      description,
      price,
      location,
      images,
    } = req.body;

    const vendorId = req.user.id;
    const isPremium = req.user.subscriptionPlan === 'premium';

    // 1. Validation
    if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
      return res.status(400).json({ success: false, message: 'Item name is required' });
    }

    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
    }

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    const numericPrice = Number(price);
    if (isNaN(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Price must be a positive number' });
    }

    if (!location || typeof location !== 'string' || !location.trim()) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    if (!images || !Array.isArray(images) || images.length === 0 || images.length > 4) {
      return res.status(400).json({
        success: false,
        message: 'Must provide between 1 and 4 image URLs',
      });
    }

    const db = getDB();
    const menuItems = db.collection('menuItems');

    // 2. Enforce Free Plan Limit (Max 10 active items: pending or approved)
    if (!isPremium) {
      const activeCount = await menuItems.countDocuments({
        vendorId,
        status: { $in: ['pending', 'approved'] },
      });

      if (activeCount >= FREE_PLAN_MAX_ACTIVE_ITEMS) {
        return res.status(403).json({
          success: false,
          code: 'PLAN_LIMIT_REACHED',
          message: `Free plan limit reached: Maximum ${FREE_PLAN_MAX_ACTIVE_ITEMS} active items allowed. Upgrade to Premium for unlimited items.`,
        });
      }
    }

    // 3. Insert menu item with default status "pending"
    const newItem = {
      vendorId,
      vendorName: req.user.businessName || req.user.name,
      itemName: itemName.trim(),
      category,
      description: description.trim(),
      price: numericPrice,
      location: location.trim(),
      images,
      status: 'pending', // Default status: pending approval
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await menuItems.insertOne(newItem);

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully and submitted for approval',
      data: {
        id: result.insertedId.toString(),
        ...newItem,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create menu item',
    });
  }
}

/**
 * GET /api/vendor/menu-items
 * List all items belonging to the authenticated vendor
 */
async function getVendorMenuItems(req, res) {
  try {
    const vendorId = req.user.id;
    const db = getDB();
    const items = await db
      .collection('menuItems')
      .find({ vendorId })
      .sort({ createdAt: -1 })
      .toArray();

    const formatted = items.map((item) => ({
      id: item._id.toString(),
      ...item,
    }));

    return res.status(200).json({
      success: true,
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve vendor items',
    });
  }
}

/**
 * GET /api/vendor/menu-items/:id
 * Get single item belonging to vendor
 */
async function getVendorMenuItemById(req, res) {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) {
      return res.status(404).json({ success: false, message: 'Invalid item ID format' });
    }

    const db = getDB();
    const item = await db.collection('menuItems').findOne({ _id: oid });

    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // Strict ownership verification
    if (item.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not own this menu item',
      });
    }

    return res.status(200).json({
      success: true,
      data: { id: item._id.toString(), ...item },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve item',
    });
  }
}

/**
 * PUT /api/vendor/menu-items/:id
 * Update an existing menu item (ownership enforced)
 */
async function updateMenuItem(req, res) {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) {
      return res.status(404).json({ success: false, message: 'Invalid item ID format' });
    }

    const db = getDB();
    const menuItems = db.collection('menuItems');
    const existing = await menuItems.findOne({ _id: oid });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // Strict ownership verification
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to modify this menu item',
      });
    }

    const {
      itemName,
      category,
      description,
      price,
      location,
      images,
    } = req.body;

    const updates = { updatedAt: new Date() };

    if (itemName !== undefined) {
      if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
        return res.status(400).json({ success: false, message: 'Item name cannot be empty' });
      }
      updates.itemName = itemName.trim();
    }

    if (category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
        });
      }
      updates.category = category;
    }

    if (description !== undefined) {
      if (!description || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ success: false, message: 'Description cannot be empty' });
      }
      updates.description = description.trim();
    }

    if (price !== undefined) {
      const num = Number(price);
      if (isNaN(num) || num <= 0) {
        return res.status(400).json({ success: false, message: 'Price must be a positive number' });
      }
      updates.price = num;
    }

    if (location !== undefined) {
      if (!location || typeof location !== 'string' || !location.trim()) {
        return res.status(400).json({ success: false, message: 'Location cannot be empty' });
      }
      updates.location = location.trim();
    }

    if (images !== undefined) {
      if (!Array.isArray(images) || images.length === 0 || images.length > 4) {
        return res.status(400).json({
          success: false,
          message: 'Must provide between 1 and 4 image URLs',
        });
      }
      updates.images = images;
    }

    await menuItems.updateOne({ _id: oid }, { $set: updates });
    const updatedItem = await menuItems.findOne({ _id: oid });

    return res.status(200).json({
      success: true,
      message: 'Menu item updated successfully',
      data: { id: updatedItem._id.toString(), ...updatedItem },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update menu item',
    });
  }
}

/**
 * DELETE /api/vendor/menu-items/:id
 * Delete an item (ownership enforced)
 */
async function deleteMenuItem(req, res) {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) {
      return res.status(404).json({ success: false, message: 'Invalid item ID format' });
    }

    const db = getDB();
    const menuItems = db.collection('menuItems');
    const existing = await menuItems.findOne({ _id: oid });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // Ownership verification
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to delete this menu item',
      });
    }

    await menuItems.deleteOne({ _id: oid });

    return res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully',
      data: { id: oid.toString() },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete menu item',
    });
  }
}

/**
 * PATCH /api/vendor/menu-items/:id/availability
 * Toggle between active (approved) and inactive
 */
async function toggleMenuItemAvailability(req, res) {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) {
      return res.status(404).json({ success: false, message: 'Invalid item ID format' });
    }

    const db = getDB();
    const menuItems = db.collection('menuItems');
    const existing = await menuItems.findOne({ _id: oid });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // Ownership verification
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not own this menu item',
      });
    }

    // Toggle: if currently inactive -> pending/approved; if active -> inactive
    let newStatus = 'inactive';
    if (existing.status === 'inactive') {
      newStatus = 'approved'; // Re-activate
    }

    await menuItems.updateOne(
      { _id: oid },
      { $set: { status: newStatus, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `Menu item status updated to ${newStatus}`,
      data: { id: oid.toString(), status: newStatus },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle availability',
    });
  }
}

// ============================================================================
// PUBLIC CONTROLLERS (No Auth Required)
// ============================================================================

/**
 * GET /api/menu-items
 * Public list of APPROVED items only with search, category, location, and sorting
 */
async function getPublicMenuItems(req, res) {
  try {
    const {
      search,
      category,
      location,
      sort = 'newest',
      page = 1,
      limit = 12,
    } = req.query;

    const db = getDB();
    const query = { status: 'approved' }; // Strict requirement: ONLY approved items

    if (search && typeof search === 'string' && search.trim()) {
      query.itemName = { $regex: search.trim(), $options: 'i' };
    }

    if (category && typeof category === 'string' && category.trim()) {
      query.category = category.trim();
    }

    if (location && typeof location === 'string' && location.trim()) {
      query.location = { $regex: location.trim(), $options: 'i' };
    }

    // Sort order
    const sortOptions = {};
    if (sort === 'price_asc') {
      sortOptions.price = 1;
    } else if (sort === 'price_desc') {
      sortOptions.price = -1;
    } else {
      sortOptions.createdAt = -1; // Default: newest
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    const total = await db.collection('menuItems').countDocuments(query);
    const items = await db
      .collection('menuItems')
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const formatted = items.map((item) => ({
      id: item._id.toString(),
      ...item,
    }));

    return res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve menu items',
    });
  }
}

/**
 * GET /api/menu-items/featured
 * Returns at least 6 approved items with Premium vendors prioritized first
 */
async function getFeaturedMenuItems(req, res) {
  try {
    const db = getDB();
    // Query approved items
    const items = await db
      .collection('menuItems')
      .find({ status: 'approved' })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    // Look up vendors to check for premium subscription plan
    const vendorIds = [...new Set(items.map((i) => i.vendorId))];
    const vendors = await db
      .collection('user')
      .find({ id: { $in: vendorIds } })
      .toArray();

    const vendorPlanMap = new Map();
    vendors.forEach((v) => vendorPlanMap.set(v.id || v._id.toString(), v.subscriptionPlan));

    // Sort: items from Premium vendors appear first
    items.sort((a, b) => {
      const planA = vendorPlanMap.get(a.vendorId) === 'premium' ? 1 : 0;
      const planB = vendorPlanMap.get(b.vendorId) === 'premium' ? 1 : 0;
      return planB - planA;
    });

    // Take top 6-12 items
    const featured = items.slice(0, 8).map((item) => ({
      id: item._id.toString(),
      ...item,
      isPremiumVendor: vendorPlanMap.get(item.vendorId) === 'premium',
    }));

    return res.status(200).json({
      success: true,
      data: featured,
      count: featured.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve featured items',
    });
  }
}

/**
 * GET /api/menu-items/:id
 * Public endpoint for single item.
 * Strict rule: Return 404 for invalid/missing IDs or non-approved items (unless requested by owner/admin).
 */
async function getPublicMenuItemById(req, res) {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    const db = getDB();
    const item = await db.collection('menuItems').findOne({ _id: oid });

    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // If item is rejected or non-approved: only allow if user is owner or admin
    if (item.status !== 'approved') {
      const requester = req.user; // If optional auth was passed
      const isOwner = requester && requester.id === item.vendorId;
      const isAdmin = requester && requester.role === 'admin';

      if (!isOwner && !isAdmin) {
        return res.status(404).json({
          success: false,
          message: 'Menu item not found or is currently not available',
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: { id: item._id.toString(), ...item },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve item',
    });
  }
}

module.exports = {
  createMenuItem,
  getVendorMenuItems,
  getVendorMenuItemById,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  getPublicMenuItems,
  getFeaturedMenuItems,
  getPublicMenuItemById,
  ALLOWED_CATEGORIES,
};
