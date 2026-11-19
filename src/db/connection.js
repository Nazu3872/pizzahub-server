const { MongoClient } = require('mongodb');
const dns = require('dns');
const config = require('../config/env');

// On Windows, configure DNS servers to reliably resolve MongoDB SRV records
if (process.platform === 'win32') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  } catch (e) {
    // fallback silently
  }
}

let cachedClient = null;
let cachedDb = null;
let isInitialized = false;

/**
 * Connect to MongoDB with cached connection for serverless/local environments
 */
async function connectDB() {
  if (cachedDb) {
    return cachedDb;
  }

  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  const client = new MongoClient(config.mongodbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  const db = client.db(config.dbName);

  cachedClient = client;
  cachedDb = db;

  // Initialize business collections and indexes once connected
  if (!isInitialized) {
    try {
      await initDB(db);
      isInitialized = true;
    } catch (err) {
      console.warn('Warning: Database index initialization encountered an issue:', err.message);
    }
  }

  return db;
}

/**
 * Return current active database instance
 */
function getDB() {
  if (!cachedDb) {
    throw new Error('Database is not initialized. Call connectDB() first.');
  }
  return cachedDb;
}

/**
 * Create collections and performance/integrity indexes
 */
async function initDB(db) {
  // 1. Transactions collection & indexes
  const transactions = db.collection('transactions');
  await transactions.createIndex({ stripeSessionId: 1 }, { unique: true, sparse: true });
  await transactions.createIndex({ vendorId: 1 });
  await transactions.createIndex({ status: 1 });

  // 2. Menu Items collection & indexes
  const menuItems = db.collection('menuItems');
  await menuItems.createIndex({ status: 1, category: 1, location: 1 });
  await menuItems.createIndex({ vendorId: 1 });

  // 3. Orders collection & indexes
  const orders = db.collection('orders');
  await orders.createIndex({ 'items.itemId': 1, deliveryDate: 1 });
  await orders.createIndex({ customerId: 1, createdAt: -1 });
  await orders.createIndex({ vendorId: 1, status: 1 });
}

/**
 * Gracefully close database connection
 */
async function closeDB() {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
    isInitialized = false;
  }
}

module.exports = {
  connectDB,
  getDB,
  initDB,
  closeDB,
};
