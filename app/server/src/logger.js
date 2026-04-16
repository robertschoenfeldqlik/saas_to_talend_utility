/**
 * Structured logging with pino.
 *
 * JSON output in production, human-readable in development.
 * Usage: const logger = require('./logger');
 *        logger.info({ runId, configId }, 'Tap sync started');
 */
const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    },
  }),
});

module.exports = logger;
