import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "../config/env";
import { createLogger } from "../lib/logger";
import { createDatabase } from "./client";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db, client } = createDatabase(env);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Database migrations applied");
} finally {
  await client.end();
}
