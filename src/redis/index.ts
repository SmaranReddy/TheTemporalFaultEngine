import Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  keyPrefix: env.REDIS_KEY_PREFIX,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    logger.warn({ attempt: times, delayMs: delay }, "Redis reconnecting");
    return delay;
  },
  maxRetriesPerRequest: 5,
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error({ err }, "Redis client error");
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
