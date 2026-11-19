const { ObjectId } = require('mongodb');
const { getDB } = require('../db/connection');
const { getStripe } = require('../utils/stripe');
const config = require('../config/env');

/**
 * POST /api/stripe/webhook (and /api/webhooks/stripe)
 * Stripe webhook handler with cryptographic signature verification.
 * Must receive raw Buffer body (express.raw BEFORE express.json).
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = config.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('Webhook error: Missing stripe-signature header or STRIPE_WEBHOOK_SECRET configuration');
    return res.status(400).json({
      success: false,
      message: 'Webhook verification failed: Missing signature or webhook secret',
    });
  }

  let event;
  const stripe = getStripe();

  try {
    // Cryptographically verify webhook signature against raw request body
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Stripe Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDB();
  const transactionsCollection = db.collection('transactions');
  const usersCollection = db.collection('user');

  try {
    switch (event.type) {
      // ----------------------------------------------------------------------
      // 1. CHECKOUT SESSION COMPLETED (Initial subscription purchase)
      // ----------------------------------------------------------------------
      case 'checkout.session.completed': {
        const session = event.data.object;
        const stripeSessionId = session.id;
        const vendorId = session.client_reference_id || session.metadata?.vendorId;

        if (!vendorId) {
          console.warn(`Webhook: Checkout session ${stripeSessionId} has no vendorId in client_reference_id or metadata`);
          return res.status(200).json({ received: true, warning: 'No vendorId found' });
        }

        // Idempotency check: duplicate events do nothing
        const existingTx = await transactionsCollection.findOne({ stripeSessionId });
        if (existingTx) {
          console.log(`Webhook: Idempotent skip - transaction for session ${stripeSessionId} already processed.`);
          return res.status(200).json({ received: true, duplicate: true });
        }

        // Retrieve subscription details for exact current_period_end
        let subscriptionExpiresAt = null;
        let stripeSubscriptionId = session.subscription || '';

        if (stripeSubscriptionId && typeof stripeSubscriptionId === 'string') {
          try {
            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            if (subscription && subscription.current_period_end) {
              subscriptionExpiresAt = new Date(subscription.current_period_end * 1000);
            }
          } catch (subErr) {
            console.warn('Could not retrieve subscription details from Stripe:', subErr.message);
          }
        }

        // Fallback: 30 days from now if period_end unavailable
        if (!subscriptionExpiresAt) {
          subscriptionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }

        // Determine paid amount
        const amount = session.amount_total
          ? Number((session.amount_total / 100).toFixed(2))
          : 29.0;
        const currency = (session.currency || 'usd').toLowerCase();

        // 1. Record immutable transaction document
        const transactionDoc = {
          vendorId: vendorId.toString(),
          plan: 'premium',
          amount: amount,
          currency: currency,
          stripeSessionId: stripeSessionId,
          stripeSubscriptionId: stripeSubscriptionId,
          status: 'completed',
          createdAt: new Date(),
        };

        try {
          await transactionsCollection.insertOne(transactionDoc);
        } catch (insertErr) {
          // If duplicate key error (E11000) on unique stripeSessionId, safely handle idempotency
          if (insertErr.code === 11000) {
            console.log(`Webhook: Idempotency race condition caught for session ${stripeSessionId}`);
            return res.status(200).json({ received: true, duplicate: true });
          }
          throw insertErr;
        }

        // 2. Activate Vendor Premium Plan in Database
        const userQuery = [{ id: vendorId.toString() }];
        if (ObjectId.isValid(vendorId)) {
          userQuery.push({ _id: new ObjectId(vendorId) });
        }

        const updateResult = await usersCollection.updateOne(
          { $or: userQuery },
          {
            $set: {
              subscriptionPlan: 'premium',
              subscriptionExpiresAt: subscriptionExpiresAt,
              stripeSubscriptionId: stripeSubscriptionId,
              updatedAt: new Date(),
            },
          }
        );

        console.log(`[Stripe Webhook] Successfully upgraded vendor ${vendorId} to Premium until ${subscriptionExpiresAt.toISOString()}`);
        break;
      }

      // ----------------------------------------------------------------------
      // 2. INVOICE PAID (Subscription renewal)
      // ----------------------------------------------------------------------
      case 'invoice.paid': {
        const invoice = event.data.object;
        const stripeSubscriptionId = invoice.subscription;

        if (stripeSubscriptionId) {
          let renewedExpiry = null;
          if (invoice.lines?.data?.[0]?.period?.end) {
            renewedExpiry = new Date(invoice.lines.data[0].period.end * 1000);
          }

          if (renewedExpiry) {
            await usersCollection.updateOne(
              { stripeSubscriptionId: stripeSubscriptionId },
              {
                $set: {
                  subscriptionPlan: 'premium',
                  subscriptionExpiresAt: renewedExpiry,
                  updatedAt: new Date(),
                },
              }
            );
            console.log(`[Stripe Webhook] Renewed subscription ${stripeSubscriptionId} until ${renewedExpiry.toISOString()}`);
          }
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 3. INVOICE PAYMENT FAILED
      // ----------------------------------------------------------------------
      case 'invoice.payment_failed': {
        const failedInvoice = event.data.object;
        console.warn(`[Stripe Webhook] Invoice payment failed for subscription ${failedInvoice.subscription}`);
        break;
      }

      // ----------------------------------------------------------------------
      // 4. CUSTOMER SUBSCRIPTION DELETED (Subscription cancelled / ended)
      // ----------------------------------------------------------------------
      case 'customer.subscription.deleted': {
        const deletedSub = event.data.object;
        const stripeSubscriptionId = deletedSub.id;

        // Downgrade vendor to free
        const downgradeResult = await usersCollection.updateOne(
          { stripeSubscriptionId: stripeSubscriptionId },
          {
            $set: {
              subscriptionPlan: 'free',
              subscriptionExpiresAt: null,
              updatedAt: new Date(),
            },
          }
        );

        console.log(`[Stripe Webhook] Downgraded vendor with subscription ${stripeSubscriptionId} to Free plan.`);
        break;
      }

      default:
        // Other events acknowledged gracefully
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`Error processing webhook event ${event?.type}:`, err);
    return res.status(500).json({
      success: false,
      message: `Error processing webhook: ${err.message}`,
    });
  }
}

module.exports = {
  handleStripeWebhook,
};
