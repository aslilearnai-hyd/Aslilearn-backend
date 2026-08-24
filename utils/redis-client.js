import IORedis from 'ioredis';

let sharedClient = null;

/** Shared Redis connection for rate limits and BullMQ (lazy singleton). */
export function getRedisClient() {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  if (!redisUrl) return null;
  if (!sharedClient) {
    sharedClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    sharedClient.connect().catch((err) => {
      console.warn('Redis connect failed — falling back to in-memory limits:', err?.message);
    });
  }
  return sharedClient;
}

export function isRedisConfigured() {
  return Boolean(String(process.env.REDIS_URL || '').trim());
}
