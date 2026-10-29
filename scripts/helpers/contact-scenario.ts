/** Snapshot one real contact mutation for the older business-rule suites. */
import { eq } from "drizzle-orm";
import { auditEvents, contactActivities, contacts, dashboardUsers } from "../../lib/db/schema.ts";
import { createLocalContactDb } from "./contact-test-db.ts";

export async function createContactScenarios(userIds: string[]) {
  const local = await createLocalContactDb();
  const { db, pg } = local;
  await db.insert(dashboardUsers).values([...new Set(userIds)].map((id) => ({
    id, clerkUserId: `user_fixture${id.replaceAll("-", "")}`, primaryEmail: `${id}@example.test`, status: "active" as const, role: "agent" as const,
  })));
  return {
    ...local,
    async run<T>(row: Record<string, unknown>, work: () => Promise<T>, failOn?: unknown) {
      await pg.exec("truncate contacts, audit_events cascade");
      await db.insert(contacts).values(row as never);
      if (failOn) {
        const table = failOn === contacts ? "contacts" : failOn === auditEvents ? "audit_events" : "contact_activities";
        await pg.exec(`create function fail_scenario() returns trigger language plpgsql as $$begin raise exception 'local failure'; end$$;
          create trigger scenario_failure before ${table === "contacts" ? "update" : "insert"} on ${table} for each row execute function fail_scenario()`);
      }
      let result: T;
      try { result = await work(); }
      finally {
        if (failOn) {
          const table = failOn === contacts ? "contacts" : failOn === auditEvents ? "audit_events" : "contact_activities";
          await pg.exec(`drop trigger scenario_failure on ${table}; drop function fail_scenario()`);
        }
      }
      const [after] = await db.select().from(contacts).where(eq(contacts.id, row.id as string));
      const activities = await db.select().from(contactActivities);
      const audits = await db.select().from(auditEvents);
      const applied: { table: unknown; kind: "insert" | "update"; values: Record<string, unknown> }[] = [];
      const changed: Record<string, unknown> = {};
      const equal = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);
      for (const key of Object.keys(row)) if (!equal(row[key], (after as unknown as Record<string, unknown>)[key])) changed[key] = (after as unknown as Record<string, unknown>)[key];
      if (Object.keys(changed).length) applied.push({ table: contacts, kind: "update", values: { ...changed, updatedByUserId: after.updatedByUserId } });
      for (const activity of activities) applied.push({ table: contactActivities, kind: "insert", values: activity as unknown as Record<string, unknown> });
      for (const audit of audits) applied.push({ table: auditEvents, kind: "insert", values: audit as unknown as Record<string, unknown> });
      return { result, m: { db, row: after, applied, batchCount: () => applied.length ? 1 : 0, batches: () => applied.length ? 1 : 0 } };
    },
  };
}
