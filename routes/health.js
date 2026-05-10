// routes/health.js
const mongoose = require('mongoose');

module.exports = async (req, res) => {
  const health = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'unknown',
    redis: 'unknown'
  };

  // Check MongoDB
  try {
    await mongoose.connection.db.admin().ping();
    health.database = 'healthy';
  } catch (error) {
    health.database = 'unhealthy';
    health.databaseError = error.message;
  }

  // Check Redis - use global client if it exists
  try {
    if (global.redisClient && process.env.USE_REDIS === 'true') {
      await global.redisClient.ping();
      health.redis = 'healthy';
    } else {
      health.redis = 'disabled';
    }
  } catch (error) {
    health.redis = 'unhealthy';
    health.redisError = error.message;
  }

  const status = health.database === 'healthy' ? 200 : 503;
  res.status(status).json(health);
};