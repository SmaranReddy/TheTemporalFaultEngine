import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index.js";
import { logger } from "../logger/index.js";

export async function runMigrations(): Promise<void> {
  logger.info("Running database migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  logger.info("Migrations complete");
}
