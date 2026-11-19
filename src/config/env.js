const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || '',
  dbName: process.env.DB_NAME || 'pizzahub',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  betterAuthJwksUrl: process.env.BETTER_AUTH_JWKS_URL || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePremiumPriceId: process.env.STRIPE_PREMIUM_PRICE_ID || '',
};

module.exports = config;
