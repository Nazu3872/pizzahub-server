const { connectDB } = require('../db/connection');

async function getHealth(req, res) {
  try {
    const db = await connectDB();
    await db.command({ ping: 1 });

    return res.status(200).json({
      success: true,
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      status: 'error',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message || 'Database connection error',
    });
  }
}

function getServiceInfo(req, res) {
  return res.status(200).json({
    success: true,
    service: 'PizzaHub API',
    version: '1.0.0',
    status: 'running',
    docs: '/health',
  });
}

module.exports = {
  getHealth,
  getServiceInfo,
};
