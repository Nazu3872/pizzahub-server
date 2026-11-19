const Stripe = require('stripe');
const config = require('../config/env');

let stripeInstance = null;

function getStripe() {
  if (!stripeInstance) {
    if (!config.stripeSecretKey) {
      console.warn('Warning: STRIPE_SECRET_KEY is not defined in environment variables.');
    }
    stripeInstance = new Stripe(config.stripeSecretKey || 'sk_test_placeholder', {
      apiVersion: '2023-10-16',
    });
  }
  return stripeInstance;
}

module.exports = {
  getStripe,
};
