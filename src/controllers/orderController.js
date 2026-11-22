const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');

// Helper: validate ObjectId
function parseObjectId(id) {
  if (!id || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

// Helper: get today's date in YYYY-MM-DD
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// CUSTOMER CONTROLLERS
// ============================================================================

/**
 * POST /api/orders
 * Create a new pizza order (Customer only)
 * Business rules:
 * 1. Customer only (admin/vendor cannot order).
 * 2. Item must exist, be approved, and active.
 * 3. Customer cannot order their own item (if vendor registered with customer role or matching IDs).
 * 4. deliveryDate cannot be in the past.
 * 5. Block duplicate ACTIVE order (pending or accepted) for same item + deliveryDate by same customer.
 */
async function createOrder(req, res) {
  try {
    const { itemId, deliveryDate, deliveryAddress, phone, message } = req.body;
    const customerId = req.user.id;

    // Rule: Role must be customer
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only customer accounts can place pizza orders',
      });
    }

    // 1. Validation: Item ID
    const itemObjectId = parseObjectId(itemId);
    if (!itemObjectId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing menu item ID',
      });
    }

    // 2. Validation: Delivery Date
    if (!deliveryDate || typeof deliveryDate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Delivery date is required (YYYY-MM-DD)',
      });
    }

    const todayStr = getTodayDateString();
    if (deliveryDate < todayStr) {
      return res.status(400).json({
        success: false,
        message: 'Delivery date cannot be in the past',
      });
    }

    // 3. Validation: Delivery Address
    if (!deliveryAddress || typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required and must be at least 5 characters',
      });
    }

    const db = getDB();
    const menuCollection = db.collection('menuItems');
    const ordersCollection = db.collection('orders');

    // 3b. Validation: Phone Number
    const phoneDigits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
    if (!phone || phoneDigits.length < 10 || phoneDigits.length > 15) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required and must contain 10-15 digits',
      });
    }

    // 4. Retrieve item and verify approval and active status
    const item = await menuCollection.findOne({ _id: itemObjectId });
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found',
      });
    }

    if (item.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Cannot order an item that has not been approved',
      });
    }

    if (item.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'This menu item is currently unavailable',
      });
    }

    // 5. Rule: Customer cannot order their own item
    if (item.vendorId && item.vendorId.toString() === customerId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot order your own menu item',
      });
    }

    // 6. Rule: Block duplicate ACTIVE order (pending or accepted) for same item + deliveryDate by same customer
    const existingActiveOrder = await ordersCollection.findOne({
      customerId: customerId.toString(),
      itemId: item._id.toString(),
      deliveryDate: deliveryDate,
      status: { $in: ['pending', 'accepted'] },
    });

    if (existingActiveOrder) {
      return res.status(400).json({
        success: false,
        message: `You already have an active order (${existingActiveOrder.status}) for this item on ${deliveryDate}`,
      });
    }

    // 7. Construct order document
    const orderDoc = {
      itemId: item._id.toString(),
      vendorId: item.vendorId.toString(),
      customerId: customerId.toString(),
      deliveryDate: deliveryDate,
      deliveryAddress: deliveryAddress.trim(),
      phone: phone.trim(),
      message: message ? message.trim() : '',
      status: 'pending', // default pending
      unitPrice: Number(item.price),
      totalPrice: Number(item.price),
      itemSnapshot: {
        itemName: item.itemName,
        category: item.category,
        price: Number(item.price),
        image: item.images?.[0] || '',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await ordersCollection.insertOne(orderDoc);

    return res.status(201).json({
      success: true,
      message: 'Pizza order placed successfully!',
      data: {
        orderId: insertResult.insertedId.toString(),
        ...orderDoc,
      },
    });
  } catch (error) {
    console.error('Error in createOrder:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to place order: ${error.message}`,
    });
  }
}

/**
 * GET /api/orders/customer
 * List orders placed by authenticated customer
 */
async function getCustomerOrders(req, res) {
  try {
    const customerId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');
    const usersCollection = db.collection('user');
    const menuCollection = db.collection('menuItems');

    const orders = await ordersCollection
      .find({ customerId })
      .sort({ createdAt: -1 })
      .toArray();

    // Fetch vendor and current item details to enrich orders
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        let vendorInfo = { businessName: 'Artisan Kitchen', name: 'Vendor', email: '' };
        let currentItem = null;

        // Fetch vendor info
        try {
          const vendorUser = await usersCollection.findOne({
            $or: [
              { id: order.vendorId },
              ...(ObjectId.isValid(order.vendorId) ? [{ _id: new ObjectId(order.vendorId) }] : []),
            ],
          });
          if (vendorUser) {
            vendorInfo = {
              businessName: vendorUser.businessName || vendorUser.name || 'Artisan Kitchen',
              name: vendorUser.name,
              email: vendorUser.email,
            };
          }
        } catch (e) {
          // ignore enrichment error
        }

        // Fetch current item details if available
        try {
          if (ObjectId.isValid(order.itemId)) {
            currentItem = await menuCollection.findOne(
              { _id: new ObjectId(order.itemId) },
              { projection: { itemName: 1, images: 1, price: 1, category: 1 } }
            );
          }
        } catch (e) {
          // ignore
        }

        return {
          id: order._id.toString(),
          _id: order._id.toString(),
          itemId: order.itemId,
          vendorId: order.vendorId,
          customerId: order.customerId,
          deliveryDate: order.deliveryDate,
          deliveryAddress: order.deliveryAddress,
          phone: order.phone || '',
          message: order.message,
          status: order.status,
          totalPrice: order.totalPrice || order.unitPrice || 0,
          item: currentItem || order.itemSnapshot || {},
          vendor: vendorInfo,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enrichedOrders,
    });
  } catch (error) {
    console.error('Error in getCustomerOrders:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch customer orders: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/orders/:id/cancel
 * Customer cancels their own pending order
 * Rules:
 * - Cancel ONLY pending orders
 * - Atomic update with status:"pending" and customerId check
 * - Cannot touch other customers' orders
 * - Cannot cancel accepted, rejected, or cancelled orders
 */
async function cancelCustomerOrder(req, res) {
  try {
    const orderId = parseObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const customerId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');

    // 1. Attempt atomic update for pending order belonging to this customer
    const updateResult = await ordersCollection.findOneAndUpdate(
      {
        _id: orderId,
        customerId: customerId,
        status: 'pending',
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (updateResult) {
      return res.status(200).json({
        success: true,
        message: 'Order cancelled successfully',
        data: {
          id: updateResult._id.toString(),
          status: updateResult.status,
          updatedAt: updateResult.updatedAt,
        },
      });
    }

    // 2. If update didn't match, inspect order to return accurate HTTP code
    const existingOrder = await ordersCollection.findOne({ _id: orderId });
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Check ownership
    if (existingOrder.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to cancel this order',
      });
    }

    // Status was not pending
    return res.status(400).json({
      success: false,
      message: `Cannot cancel order with status "${existingOrder.status}". Only pending orders can be cancelled.`,
    });
  } catch (error) {
    console.error('Error in cancelCustomerOrder:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to cancel order: ${error.message}`,
    });
  }
}

// ============================================================================
// VENDOR CONTROLLERS
// ============================================================================

/**
 * GET /api/orders/vendor
 * List orders for items belonging to the authenticated vendor
 */
async function getVendorOrders(req, res) {
  try {
    const vendorId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');
    const usersCollection = db.collection('user');
    const menuCollection = db.collection('menuItems');

    const orders = await ordersCollection
      .find({ vendorId })
      .sort({ createdAt: -1 })
      .toArray();

    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        let customerInfo = { name: 'Customer', email: '' };
        let currentItem = null;

        // Customer details
        try {
          const customerUser = await usersCollection.findOne({
            $or: [
              { id: order.customerId },
              ...(ObjectId.isValid(order.customerId) ? [{ _id: new ObjectId(order.customerId) }] : []),
            ],
          });
          if (customerUser) {
            customerInfo = {
              name: customerUser.name,
              email: customerUser.email,
              image: customerUser.image || '',
            };
          }
        } catch (e) {
          // ignore
        }

        // Item details
        try {
          if (ObjectId.isValid(order.itemId)) {
            currentItem = await menuCollection.findOne(
              { _id: new ObjectId(order.itemId) },
              { projection: { itemName: 1, images: 1, price: 1, category: 1 } }
            );
          }
        } catch (e) {
          // ignore
        }

        return {
          id: order._id.toString(),
          _id: order._id.toString(),
          itemId: order.itemId,
          vendorId: order.vendorId,
          customerId: order.customerId,
          deliveryDate: order.deliveryDate,
          deliveryAddress: order.deliveryAddress,
          phone: order.phone || '',
          message: order.message,
          status: order.status,
          totalPrice: order.totalPrice || order.unitPrice || 0,
          item: currentItem || order.itemSnapshot || {},
          customer: customerInfo,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enrichedOrders,
    });
  } catch (error) {
    console.error('Error in getVendorOrders:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch vendor orders: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/orders/:id/accept
 * Vendor accepts order
 * Rules:
 * - Accept ONLY pending orders
 * - Accept ONLY once (atomic update)
 * - Cannot touch other vendors' orders
 */
async function acceptVendorOrder(req, res) {
  try {
    const orderId = parseObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const vendorId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');

    // Atomic update
    const updateResult = await ordersCollection.findOneAndUpdate(
      {
        _id: orderId,
        vendorId: vendorId,
        status: 'pending',
      },
      {
        $set: {
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (updateResult) {
      return res.status(200).json({
        success: true,
        message: 'Order accepted successfully',
        data: {
          id: updateResult._id.toString(),
          status: updateResult.status,
          acceptedAt: updateResult.acceptedAt,
          updatedAt: updateResult.updatedAt,
        },
      });
    }

    // Inspect order to return precise code
    const existingOrder = await ordersCollection.findOne({ _id: orderId });
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (existingOrder.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to manage this order',
      });
    }

    return res.status(400).json({
      success: false,
      message: `Cannot accept order with status "${existingOrder.status}". Only pending orders can be accepted.`,
    });
  } catch (error) {
    console.error('Error in acceptVendorOrder:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to accept order: ${error.message}`,
    });
  }
}

/**
 * PATCH /api/orders/:id/reject
 * Vendor rejects order
 * Rules:
 * - Reject ONLY pending orders
 * - Reject ONLY once (atomic update)
 * - Cannot touch other vendors' orders
 */
async function rejectVendorOrder(req, res) {
  try {
    const orderId = parseObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const vendorId = req.user.id.toString();
    const db = getDB();
    const ordersCollection = db.collection('orders');

    // Atomic update
    const updateResult = await ordersCollection.findOneAndUpdate(
      {
        _id: orderId,
        vendorId: vendorId,
        status: 'pending',
      },
      {
        $set: {
          status: 'rejected',
          rejectedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (updateResult) {
      return res.status(200).json({
        success: true,
        message: 'Order rejected',
        data: {
          id: updateResult._id.toString(),
          status: updateResult.status,
          rejectedAt: updateResult.rejectedAt,
          updatedAt: updateResult.updatedAt,
        },
      });
    }

    // Inspect order to return precise code
    const existingOrder = await ordersCollection.findOne({ _id: orderId });
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (existingOrder.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to manage this order',
      });
    }

    return res.status(400).json({
      success: false,
      message: `Cannot reject order with status "${existingOrder.status}". Only pending orders can be rejected.`,
    });
  } catch (error) {
    console.error('Error in rejectVendorOrder:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to reject order: ${error.message}`,
    });
  }
}

// ============================================================================
// SHARED / DETAILS CONTROLLER
// ============================================================================

/**
 * GET /api/orders/:id
 * Get single order details with permission check (customer, vendor, or admin)
 */
async function getOrderById(req, res) {
  try {
    const orderId = parseObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const userId = req.user.id.toString();
    const role = req.user.role;
    const db = getDB();
    const ordersCollection = db.collection('orders');
    const usersCollection = db.collection('user');
    const menuCollection = db.collection('menuItems');

    const order = await ordersCollection.findOne({ _id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Permission check: customer who placed, vendor who received, or admin
    const isCustomer = order.customerId === userId;
    const isVendor = order.vendorId === userId;
    const isAdmin = role === 'admin';

    if (!isCustomer && !isVendor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view this order',
      });
    }

    // Enrich with customer, vendor, and item
    let customerInfo = { name: 'Customer', email: '' };
    let vendorInfo = { businessName: 'Artisan Kitchen', name: 'Vendor', email: '' };
    let currentItem = null;

    try {
      const customerUser = await usersCollection.findOne({
        $or: [
          { id: order.customerId },
          ...(ObjectId.isValid(order.customerId) ? [{ _id: new ObjectId(order.customerId) }] : []),
        ],
      });
      if (customerUser) {
        customerInfo = {
          name: customerUser.name,
          email: customerUser.email,
        };
      }
    } catch (e) {}

    try {
      const vendorUser = await usersCollection.findOne({
        $or: [
          { id: order.vendorId },
          ...(ObjectId.isValid(order.vendorId) ? [{ _id: new ObjectId(order.vendorId) }] : []),
        ],
      });
      if (vendorUser) {
        vendorInfo = {
          businessName: vendorUser.businessName || vendorUser.name || 'Artisan Kitchen',
          name: vendorUser.name,
          email: vendorUser.email,
        };
      }
    } catch (e) {}

    try {
      if (ObjectId.isValid(order.itemId)) {
        currentItem = await menuCollection.findOne(
          { _id: new ObjectId(order.itemId) },
          { projection: { itemName: 1, images: 1, price: 1, category: 1, location: 1 } }
        );
      }
    } catch (e) {}

    return res.status(200).json({
      success: true,
      data: {
        id: order._id.toString(),
        _id: order._id.toString(),
        itemId: order.itemId,
        vendorId: order.vendorId,
        customerId: order.customerId,
        deliveryDate: order.deliveryDate,
        deliveryAddress: order.deliveryAddress,
        phone: order.phone || '',
        message: order.message,
        status: order.status,
        totalPrice: order.totalPrice || order.unitPrice || 0,
        item: currentItem || order.itemSnapshot || {},
        customer: customerInfo,
        vendor: vendorInfo,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        acceptedAt: order.acceptedAt,
        rejectedAt: order.rejectedAt,
        cancelledAt: order.cancelledAt,
      },
    });
  } catch (error) {
    console.error('Error in getOrderById:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to retrieve order: ${error.message}`,
    });
  }
}

module.exports = {
  createOrder,
  getCustomerOrders,
  cancelCustomerOrder,
  getVendorOrders,
  acceptVendorOrder,
  rejectVendorOrder,
  getOrderById,
};
