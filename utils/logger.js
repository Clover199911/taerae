/**
 * Centralized Logger Utility
 * Use this instead of console.log/error throughout the codebase
 */
const winston = require('winston');
const path = require('path');

// Create logs directory reference (should exist)
const logsDir = path.join(__dirname, '..', 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'card-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    })
  ]
});

// Convenience methods for common logging patterns
logger.command = (commandName, userId, message) => {
  logger.info(`[CMD:${commandName}] User ${userId}: ${message}`);
};

logger.service = (serviceName, message, data = {}) => {
  logger.info(`[${serviceName}] ${message}`, data);
};

logger.serviceError = (serviceName, message, error) => {
  logger.error(`[${serviceName}] ${message}`, { error: error.message, stack: error.stack });
};

module.exports = logger;
