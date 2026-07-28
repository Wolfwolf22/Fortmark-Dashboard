import type { Config } from "drizzle-kit";

/**
 * Migrations are generated from `lib/db/schema.ts` and applied per environment.
 * The URL is read at run time and never committed — `db:generate` works without
 * it, so schema changes can be authored with no database attached.
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
} satisfies Config;
