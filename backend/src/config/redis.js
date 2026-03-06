const { Redis } = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_URL
    ? new URL(process.env.REDIS_URL).hostname
    : 'localhost',
  port: process.env.REDIS_URL
    ? parseInt(new URL(process.env.REDIS_URL).port, 10)
    : 6379,
  maxRetriesPerRequest: null, // required for BullMQ
  retryStrategy: (times) => Math.min(times * 100, 3000),
};

// Separate connections: BullMQ needs its own
const redisClient = new Redis(redisConfig);
const bullRedis = new Redis(redisConfig); // for BullMQ

redisClient.on('connect', () => console.log('[Redis] Connected'));
redisClient.on('error', (err) => console.error('[Redis] Error:', err.message));

module.exports = { redisClient, bullRedis, redisConfig };