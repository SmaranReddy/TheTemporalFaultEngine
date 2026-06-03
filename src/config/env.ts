import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  DATABASE_HOST: z.string().default("localhost"),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_NAME: z.string().default("temporal_fault_engine"),
  DATABASE_USER: z.string().default("postgres"),
  DATABASE_PASSWORD: z.string().default("postgres"),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().default(30000),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(""),
  REDIS_KEY_PREFIX: z.string().default("tfe:"),

  LEASE_DURATION_MS: z.coerce.number().default(30000),
  LEASE_RENEWAL_INTERVAL_MS: z.coerce.number().default(10000),
  LEASE_REAPER_INTERVAL_MS: z.coerce.number().default(15000),

  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  SCHEDULER_BATCH_SIZE: z.coerce.number().default(100),

  WORKER_ID: z.string().default("worker-1"),
  PORT: z.coerce.number().default(3001),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Environment validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
