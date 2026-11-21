const app = require('../src/app');
const { connectDB } = require('../src/db/connection');

// Serverless handler for Vercel deployment with automatic DB initialization
module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('Error connecting to database in serverless handler:', err.message);
  }
  return app(req, res);
};
