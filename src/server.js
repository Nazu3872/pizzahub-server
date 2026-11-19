const app = require('./app');
const config = require('./config/env');
const { connectDB } = require('./db/connection');

async function startServer() {
  try {
    if (config.mongodbUri) {
      await connectDB();
      console.log(`Connected to MongoDB Atlas: database "${config.dbName}"`);
    } else {
      console.warn('Warning: MONGODB_URI not set. Running in offline/degraded mode.');
    }

    const server = app.listen(config.port, () => {
      console.log(`PizzaHub server running on port ${config.port} [${config.nodeEnv}]`);
      console.log(`Allowed client URL: ${config.clientUrl}`);
    });

    const shutdown = async () => {
      console.log('Shutting down server gracefully...');
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
