import type { Config } from "drizzle-kit";

/**
 * Migrations are generated from `lib/db/schema.ts` and applied per environment.
 *
 * Schema changes use DATABASE_URL_UNPOOLED when Neon provides it. DDL wants a
 * direct connection: the pooler multiplexes statements across backends, which
 * can break advisory locks and long-running ALTERs. Runtime is unaffected —
 * `lib/db/client.ts` keeps using DATABASE_URL over neon-http, which is the
 * correct driver for stateless serverless invocations.
 *
 * The URL is read at run time and never committed, so `db:generate` works with
 * no database attached.
 */
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim() || "";

export default {
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
} satisfies Config;
