import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { contacts } from "../db/schema.ts";
export { contactCreateRequests } from "../db/schema.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function createPayloadHash(input: Record<string, unknown>): string {
  const { requestId: _requestId, ...payload } = input;
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

/** Date DTOs have milliseconds; old PostgreSQL default-now rows may have more. */
export function revisionMatches(updatedAt: Date, expected: string): boolean {
  return Number.isFinite(Date.parse(expected)) && updatedAt.getTime() === Date.parse(expected);
}

export function contactRevision(expected: string) {
  return sql`date_trunc('milliseconds', ${contacts.updatedAt}) = ${expected}::timestamptz`;
}

/** Every writer advances the public token, even twice within one millisecond. */
export function nextContactUpdatedAt(now: Date) {
  return sql`greatest(date_trunc('milliseconds', ${contacts.updatedAt}) + interval '1 millisecond', ${now.toISOString()}::timestamptz)`;
}
