/** Real PostgreSQL semantics, isolated in memory. Never reads connection env. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../../lib/db/client.ts";
import * as schema from "../../lib/db/schema.ts";

export async function createLocalContactDb() {
  const pg = new PGlite();
  const folder = new URL("../../lib/db/migrations/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", folder), "utf8")) as { entries: { tag: string }[] };
  for (const entry of journal.entries) await pg.exec(readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8"));
  const base = drizzle(pg, { schema });
  // Neon batches execute prepared statements as a single transaction. Mirror
  // that transport contract while the actual SQL is evaluated by PostgreSQL.
  const db = Object.assign(base, {
    batch: async (statements: { toSQL(): { sql: string; params: unknown[] } }[]) => pg.transaction(async (tx) => {
      const results = [];
      for (const statement of statements) {
        const query = statement.toSQL();
        results.push((await tx.query(query.sql, query.params)).rows);
      }
      return results;
    }),
  }) as unknown as Db;
  return { pg, db };
}
