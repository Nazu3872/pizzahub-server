const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');
const { getStripe } = require('../utils/stripe');
const config = require('../config/env');

/**
 * POST /api/subscription/checkout
 * Create a Stripe Checkout Session for vendor Premium subscription
 * Rules:
 * - Vendor role only
 * - vendorId comes from verified token (req.user.id), NEVER from the body
 * - Reject if vendor is already Premium
 * - Mode: subscription
 * - Success URL: /payment/success?session_id={CHECKOUT_SESSION_ID}
 * - Cancel URL: /payment/cancel
 */
async function createCheckoutSession(req, res) {
  try {
    const vendorId = req.user.id;

    // Rule: Reject if vendor is already Premium
    if (req.user.subscriptionPlan === 'premium') {
      return res.status(400).json({
        success: false,
        message: 'You are already subscribed to the Premium plan.',
      });
    }

    const stripe = getStripe();
    const successUrl = `${config.clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.clientUrl}/payment/cancel`;

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      client_reference_id: vendorId.toString(),
      customer_email: req.user.email,
      metadata: {
        vendorId: vendorId.toString(),
        vendorEmail: req.user.email,
        role: 'vendor',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (config.stripePremiumPriceId) {
      sessionParams.line_items = [
        {
          price: config.stripePremiumPriceId,
          quantity: 1,
        },
      ];
    } else {
      // Dynamic fallback pricing if price ID not yet configured in Stripe dashboard
      sessionParams.line_items = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'PizzaHub Vendor Premium Subscription',
              description:
                'Unlimited active menu items, featured homepage placement, and verified artisan badge.',
            },
            unit_amount: 2900, // $29.00 / month
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to create Stripe checkout session: ${error.message}`,
    });
  }
}

/**
 * GET /api/subscription/status
 * Read fresh vendor subscription status directly from MongoDB database.
 * Used by success page for polling until webhook activates the plan.
 */
async function getSubscriptionStatus(req, res) {
  try {
    const vendorId = req.user.id;
    const db = getDB();
    const usersCollection = db.collection('user');

    const userQuery = [{ id: vendorId.toString() }];
    if (ObjectId.isValid(vendorId)) {
      userQuery.push({ _id: new ObjectId(vendorId) });
    }

    const user = await usersCollection.findOne({ $or: userQuery });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Vendor account not found',
      });
    }

    const plan = user.subscriptionPlan || 'free';
    const isPremium = plan === 'premium';

    return res.status(200).json({
      success: true,
      data: {
        vendorId: user.id || user._id.toString(),
        businessName: user.businessName || user.name,
        subscriptionPlan: plan,
        subscriptionExpiresAt: user.subscriptionExpiresAt || null,
        isPremium: isPremium,
      },
    });
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch subscription status: ${error.message}`,
    });
  }
}

/**
 * GET /api/admin/transactions
 * Read-only list of platform transactions for admin inspection.
 * Admin cannot edit transactions (read-only GET only!).
 */
async function getAdminTransactions(req, res) {
  try {
    const db = getDB();
    const transactionsCollection = db.collection('transactions');

    const transactions = await transactionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error('Error in getAdminTransactions:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to retrieve transactions: ${error.message}`,
    });
  }
}

module.exports = {
  createCheckoutSession,
  getSubscriptionStatus,
  getAdminTransactions,
};
