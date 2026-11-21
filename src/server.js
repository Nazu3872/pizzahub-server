const app = require('./app');
const config = require('./config/env');
const { connectDB } = require('./db/connection');

async function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`PizzaHub server running on port ${config.port} [${config.nodeEnv}]`);
    console.log(`Allowed client URL: ${config.clientUrl}`);
  });

  if (config.mongodbUri) {
    try {
      await connectDB();
      console.log(`Connected to MongoDB Atlas: database "${config.dbName}"`);
    } catch (err) {
      console.warn(`Warning: Initial MongoDB Atlas connection failed: ${err.message}`);
      console.warn('The server is alive and will retry connecting on incoming requests.');
    }
  } else {
    console.warn('Warning: MONGODB_URI not set. Running in offline/degraded mode.');
  }

  const shutdown = async () => {
    console.log('Shutting down server gracefully...');
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
