import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Env } from "../config/env";

export function createDatabase(env: Env) {
  const client = postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
