import { getRedisClient } from './redis-client.js';

/** express-rate-limit v8 compatible Redis store (falls back if Redis unavailable). */
export class RedisRateLimitStore {
  constructor({ prefix = 'rl', windowMs = 60_000 } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.redis = getRedisClient();
    this.local = new Map();
  }

  key(k) {
    return `${this.prefix}:${k}`;
  }

  async increment(k) {
    if (!this.redis) {
      return this.incrementLocal(k);
    }
    try {
      const redisKey = this.key(k);
      const totalHits = await this.redis.incr(redisKey);
      if (totalHits === 1) {
        await this.redis.pexpire(redisKey, this.windowMs);
      }
      const ttl = await this.redis.pttl(redisKey);
      const resetTime = new Date(Date.now() + Math.max(ttl, 0));
      return { totalHits, resetTime };
    } catch {
      return this.incrementLocal(k);
    }
  }

  incrementLocal(k) {
    const now = Date.now();
    const row = this.local.get(k);
    if (!row || row.resetTime.getTime() <= now) {
      const resetTime = new Date(now + this.windowMs);
      this.local.set(k, { totalHits: 1, resetTime });
      return { totalHits: 1, resetTime };
    }
    row.totalHits += 1;
    return { totalHits: row.totalHits, resetTime: row.resetTime };
  }

  async decrement(k) {
    if (!this.redis) {
      const row = this.local.get(k);
      if (row && row.totalHits > 0) row.totalHits -= 1;
      return;
    }
    try {
      await this.redis.decr(this.key(k));
    } catch {
      /* ignore */
    }
  }

  async resetKey(k) {
    if (!this.redis) {
      this.local.delete(k);
      return;
    }
    try {
      await this.redis.del(this.key(k));
    } catch {
      /* ignore */
    }
  }
}

export function createRateLimitStore(prefix, windowMs) {
  if (!String(process.env.REDIS_URL || '').trim()) return undefined;
  return new RedisRateLimitStore({ prefix, windowMs });
}
