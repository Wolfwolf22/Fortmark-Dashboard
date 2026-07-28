/**
 * Applies committed migrations using the same neon-http driver the runtime
 * uses.
 *
 * drizzle-kit auto-selects @neondatabase/serverless when it is installed, and
 * that path expects a websocket, so `drizzle-kit migrate` fails against a
 * plain connection string. The neon-http migrator issues the SQL over HTTPS
 * instead, which is what this deployment target supports.
 *
 * Prefers the unpooled URL for DDL and falls back to the pooled one.
 * Never prints any part of either value.
 *
 * Run: npm run db:migrate
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();

if (!url) {
  console.log("no database URL configured — nothing to migrate");
  process.exit(1);
}
console.log(
  `migrating with ${process.env.DATABASE_URL_UNPOOLED?.trim() ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL"}`
);

const db = drizzle(neon(url));
await migrate(db, { migrationsFolder: "./lib/db/migrations" });
console.log("migrations applied");
