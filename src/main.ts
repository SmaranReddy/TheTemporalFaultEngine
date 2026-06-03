import { env } from "./config/env.js";
import { logger } from "./logger/index.js";
import { healthCheck as dbHealthCheck, closeDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { healthCheck as redisHealthCheck, closeRedis } from "./redis/index.js";
import { recoverOrphanedLeases } from "./recovery/index.js";
import { createReaper } from "./reaper/index.js";
import { createScheduler } from "./scheduler/index.js";
import { createApiServer } from "./api/server.js";

async function main(): Promise<void> {
  logger.info(
    { workerId: env.WORKER_ID, nodeEnv: env.NODE_ENV },
    "Temporal Fault Engine starting"
  );

  // ─── Phase 1: Health probes ─────────────────────────────────────
  const dbOk = await dbHealthCheck();
  if (!dbOk) {
    logger.fatal("Database unreachable on startup");
    process.exit(1);
  }
  logger.info("Database healthy");

  const redisOk = await redisHealthCheck();
  if (!redisOk) {
    logger.fatal("Redis unreachable on startup");
    process.exit(1);
  }
  logger.info("Redis healthy");

  // ─── Phase 2: Database migrations ───────────────────────────────
  await runMigrations();

  // ─── Phase 3: Crash recovery ────────────────────────────────────
  // Runs ONCE before any subsystem starts.
  // Reclaims any events this worker claimed before a previous crash.
  const { orphanedLeases } = await recoverOrphanedLeases();
  if (orphanedLeases > 0) {
    logger.info({ count: orphanedLeases }, "Crash recovery reclaimed leases");
  }

  // ─── Phase 4: Start subsystems ──────────────────────────────────
  const reaper = createReaper();
  const scheduler = createScheduler();
  const apiServer = createApiServer();

  reaper.start();
  scheduler.start();
  await apiServer.start();

  logger.info("Temporal Fault Engine ready");

  // ─── Graceful shutdown ──────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");

    // Stop subsystems in reverse order
    await apiServer.stop();
    scheduler.stop();
    reaper.stop();

    await closeDb();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
