/** Merges preserve all private-file identities and enforce representation against the locked snapshot. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { contactEngagementFiles, contacts, dashboardUsers } from "../lib/db/schema.ts";
import { createContact, type Ctx } from "../lib/contacts/service.ts";
import { createContactSchema } from "../lib/contacts/domain.ts";
import { getContactMergeReview, mergeContacts } from "../lib/contacts/merge-service.ts";
import type { ContactMergeInput } from "../lib/contacts/merge.ts";

const { pg, db } = await createLocalContactDb(), owner = randomUUID();
const ctx: Ctx = { db, actor: { userId: owner, role: "agent", brokerageKey: "fortmark" } };
let checks = 0;
function check(condition: unknown, message: string): asserts condition { assert.ok(condition, message); checks++; }
async function contact(name: string) { const result = await createContact(ctx, createContactSchema.parse({ firstName: name })); check(result.ok, "Fixture contact created"); return result.value.id; }
async function file(contactId: string, removed = false) {
  const id = randomUUID(), storagePath = `contact-engagements/${contactId}/${id}.pdf`;
  await db.insert(contactEngagementFiles).values({ id, contactId, storagePath, filename: "broker-engagement.pdf", contentType: "application/pdf", sizeBytes: 100, sha256: "f".repeat(64), uploadedByUserId: owner, ...(removed ? { removedAt: new Date() } : {}) });
  return { id, storagePath };
}
async function reviewed(a: string, b: string): Promise<ContactMergeInput> {
  const r = await getContactMergeReview(ctx, a, b); check(r.ok, "Authorized merge review loads");
  return { requestId: randomUUID(), primaryId: a, duplicateId: b, expectedPrimaryUpdatedAt: r.value.primary.updatedAt, expectedDuplicateUpdatedAt: r.value.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: r.value.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: r.value.duplicate.historyFingerprint, choices: r.value.defaults, nextActionChoice: "none" };
}
try {
  await db.insert(dashboardUsers).values({ id: owner, clerkUserId: `merge-file-${owner}`, primaryEmail: "synthetic@example.test", role: "agent", status: "active" });
  const a = await contact("Keeper"), b = await contact("Source"), keeper = await file(a), source = await file(b), historical = await file(b, true);
  const input = await reviewed(a, b), saved = await mergeContacts(ctx, input);
  check(saved.ok, "Two attached contacts merge without violating the one-PDF constraint");
  const files = await db.select().from(contactEngagementFiles).where(eq(contactEngagementFiles.contactId, a));
  check(files.length === 3, "Every current and historical file identity is retained");
  check(files.filter(row => !row.removedAt).length === 1 && files.find(row => row.id === keeper.id)?.removedAt === null, "Keeper's PDF remains the sole active document");
  check(Boolean(files.find(row => row.id === source.id)?.removedAt), "Source's competing PDF becomes retained history");
  check(files.find(row => row.id === source.id)?.storagePath === source.storagePath && files.some(row => row.id === historical.id), "Original private storage paths and removed history survive");
  check((await mergeContacts(ctx, input)).ok, "Merge receipt retry does not duplicate files");

  const c = await contact("No PDF keeper"), d = await contact("Only source PDF"), only = await file(d);
  check((await mergeContacts(ctx, await reviewed(c, d))).ok, "The source PDF can be adopted when the keeper has none");
  const [adopted] = await db.select().from(contactEngagementFiles).where(eq(contactEngagementFiles.id, only.id));
  check(adopted.contactId === c && adopted.removedAt === null && adopted.storagePath === only.storagePath, "Adopted PDF remains current at its original private location");

  const e = await contact("Legacy lead"), f = await contact("Legacy represented contact");
  await db.update(contacts).set({ stage: "representation" }).where(eq(contacts.id, f));
  const missing = await reviewed(e, f); missing.choices.stage = "duplicate"; missing.engagementAcknowledged = true;
  const denied = await mergeContacts(ctx, missing);
  check(!denied.ok && denied.reason === "engagement_required", "Merge cannot bypass the required PDF when entering representation");
  const attached = await file(f), proof = await reviewed(e, f); proof.choices.stage = "duplicate"; proof.engagementAcknowledged = true;
  check((await mergeContacts(ctx, proof)).ok, "Reviewed representation with the source's current PDF succeeds");
  const [transferred] = await db.select().from(contactEngagementFiles).where(eq(contactEngagementFiles.id, attached.id));
  check(transferred.contactId === e && transferred.removedAt === null, "Representation retains its supporting file");

  const g = await contact("Concurrent keeper"), h = await contact("Concurrent source"), changing = await file(h), race = await reviewed(g, h);
  await db.update(contactEngagementFiles).set({ filename: "revised.pdf", updatedAt: new Date() }).where(eq(contactEngagementFiles.id, changing.id));
  const stale = await mergeContacts(ctx, race);
  check(!stale.ok && stale.reason === "conflict", "A file change invalidates the reviewed history fingerprint");
  const [untouched] = await db.select().from(contacts).where(eq(contacts.id, h));
  check(untouched.mergedIntoContactId === null, "A stale merge never partially reparents contact records");
  console.log(`${checks}/${checks} contact engagement merge checks passed (isolated PostgreSQL)`);
} finally { await pg.close(); }
