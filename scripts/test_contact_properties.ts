/** Manual saved MLS references, against isolated PostgreSQL and a fake provider only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contactProperties, contacts, dashboardUsers } from "../lib/db/schema.ts";
import type { Db } from "../lib/db/client.ts";
import type { Listing } from "../lib/data/types.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import { addContactProperty, getContactProperties, lookupContactProperty, removeContactProperty } from "../lib/contacts/properties-service.ts";
import { addPropertyInputSchema, propertyLookupInputSchema, normalizePropertyMlsNumber, readPropertyQuery, type PropertyMlsProvider, type PropertyResolution } from "../lib/contacts/properties.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-10-30T15:00:00.000Z");
function listing(id: string, mlsNumber: string, price = 795_000): Listing {
  return { id, mlsNumber, address: "Synthetic property", city: "Sample", zip: "00000", status: "active", propertyType: "condo", listPrice: price,
    beds: 2, baths: 2, sqft: 1200, listedDate: now.toISOString(), agentId: "", photos: ["https://example.test/synthetic.jpg"], description: "Synthetic MLS text", priceHistory: [], source: "mls" };
}
const resolved = (id = "listing-1", number = "A000123", price = 795_000): PropertyResolution => ({ ok: true, value: { dataset: "synthetic_mls", listing: listing(id, number, price) } });
let lookupCalls = 0, getCalls = 0;
let lookupResult = resolved(), getResult = resolved();
const provider: PropertyMlsProvider = {
  lookup: async () => { lookupCalls++; return lookupResult; },
  get: async () => { getCalls++; return getResult; },
};
check("MLS number trims/case-folds and keeps leading zeroes", normalizePropertyMlsNumber(" a000123 ") === "A000123");
for (const value of [undefined, null, "", " ", "HOME", "A 123", "12' or 1=1", "x".repeat(41), "A12\0"]) check("not an exact MLS number is refused", normalizePropertyMlsNumber(value) === null);
check("hyphenated MLS identifiers remain exact", normalizePropertyMlsNumber("r-00123") === "R-00123");
check("lookup accepts only MLS identifier", propertyLookupInputSchema.safeParse({ mlsNumber: "a123" }).success && !propertyLookupInputSchema.safeParse({ mlsNumber: "A123", listing: listing("fake", "A123") }).success);
check("add accepts reference and expected durable source/identity only", addPropertyInputSchema.safeParse({ mlsNumber: "A123", expectedDataset: "synthetic_mls", expectedListingId: "key-1" }).success && !addPropertyInputSchema.safeParse({ mlsNumber: "A123", expectedDataset: "synthetic_mls", expectedListingId: "key-1", listPrice: 1 }).success);
for (const value of ["", " ", "\0", "x".repeat(257)]) check("unusable expected key is refused", !addPropertyInputSchema.safeParse({ mlsNumber: "A123", expectedDataset: "synthetic_mls", expectedListingId: value }).success);
for (const value of [undefined, "", " ", "bad source", "\0", "x".repeat(81)]) check("missing or unusable reviewed source is refused", !addPropertyInputSchema.safeParse({ mlsNumber: "A123", expectedDataset: value, expectedListingId: "key-1" }).success);
check("reviewed dataset accepts the exact safe80-character bound", addPropertyInputSchema.safeParse({ mlsNumber: "A123", expectedDataset: "x".repeat(80), expectedListingId: "key-1" }).success);
check("page defaults are12 and maximum24", readPropertyQuery(new URLSearchParams())?.pageSize === 12 && readPropertyQuery(new URLSearchParams("page=2&pageSize=24"))?.page === 2);
for (const query of ["page=0", "page=-1", "page=1.5", "pageSize=25", "pageSize=0", "q=private", "page=1000001"]) check("invalid or broad search query is refused", readPropertyQuery(new URLSearchParams(query)) === null);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: randomUUID() }, admin = { ...actor, userId: randomUUID(), role: "admin" as const };
const ctx: Ctx = { actor, db }, reader: Ctx = { actor: { ...actor, role: "member" }, db };
const contactId = randomUUID(), secondId = randomUUID(), hiddenId = randomUUID(), anotherBookId = randomUUID();
async function count() { return (await db.select().from(contactProperties)).length; }
async function auditCount() { return (await db.select().from(auditEvents)).length; }
function beforeBatch(work: () => Promise<void>): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) {
    if (property === "batch") return async (writes: Parameters<Db["batch"]>[0]) => { if (pending) { pending = false; await work(); } return target.batch(writes); };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_property_${index}`, primaryEmail: `property${index}@example.test`, status: "active" as const })));
  await db.insert(contacts).values([
    { id: contactId, assignedAgentUserId: actor.userId, firstName: "Synthetic property contact", updatedAt: now },
    { id: secondId, assignedAgentUserId: actor.userId, firstName: "Second synthetic contact", updatedAt: now },
    { id: hiddenId, assignedAgentUserId: other.userId, firstName: "Hidden synthetic contact", updatedAt: now },
    { id: anotherBookId, assignedAgentUserId: actor.userId, brokerageKey: "elsewhere", firstName: "Another book", updatedAt: now },
  ]);
  for (const id of [hiddenId, anotherBookId, randomUUID(), "invalid"]) {
    const before = lookupCalls + getCalls;
    check("out-of-scope lookup is refused", !(await lookupContactProperty(ctx, id, { mlsNumber: "A000123" }, provider)).ok);
    check("out-of-scope add is refused", !(await addContactProperty(ctx, id, { mlsNumber: "A000123", expectedDataset: "synthetic_mls", expectedListingId: "listing-1" }, provider, now)).ok);
    check("out-of-scope saved page is refused", !(await getContactProperties(ctx, id, provider)).ok);
    check("refused scope never reaches MLS", lookupCalls + getCalls === before);
  }
  const beforeReader = lookupCalls;
  check("read-only member cannot lookup or add", !(await lookupContactProperty(reader, contactId, { mlsNumber: "A000123" }, provider)).ok && !(await addContactProperty(reader, contactId, { mlsNumber: "A000123", expectedDataset: "synthetic_mls", expectedListingId: "listing-1" }, provider)).ok);
  check("read-only workflow never reaches lookup provider", lookupCalls === beforeReader);
  check("malformed input never reaches MLS", !(await lookupContactProperty(ctx, contactId, { mlsNumber: "address text" }, provider)).ok && lookupCalls === beforeReader);

  for (const reason of ["not_found", "unavailable", "not_configured", "ambiguous"] as const) {
    lookupResult = { ok: false, reason };
    const result = await lookupContactProperty(ctx, contactId, { mlsNumber: "A000123" }, provider);
    check("provider failure remains a controlled lookup refusal", !result.ok && result.reason === (reason === "not_found" ? "listing_not_found" : reason));
  }
  const thrown = await lookupContactProperty(ctx, contactId, { mlsNumber: "A000123" }, { ...provider, lookup: async () => { throw new Error("Sensitive synthetic provider failure"); } });
  check("thrown provider details are hidden", !thrown.ok && thrown.reason === "unavailable");
  lookupResult = resolved("wrong-key", "A999");
  check("wrong MLS lookup is not treated as an exact match", !(await lookupContactProperty(ctx, contactId, { mlsNumber: "A000123" }, provider)).ok);
  lookupResult = resolved();
  const preview = await lookupContactProperty(ctx, contactId, { mlsNumber: " a000123 " }, provider);
  check("exact preview includes reviewed source and remains read-only", preview.ok && preview.value.dataset === "synthetic_mls" && !preview.value.alreadySaved && await count() === 0 && await auditCount() === 0);
  lookupResult = { ok: true, value: { dataset: "changed_source", listing: listing("listing-1", "A000123") } };
  const changedSource = await addContactProperty(ctx, contactId, { mlsNumber: "A000123", expectedDataset: preview.value.dataset, expectedListingId: "listing-1" }, provider, now);
  check("source switch with identical MLSnumber/key requires a fresh review and writes nothing", !changedSource.ok && changedSource.reason === "listing_changed" && await count() === 0 && await auditCount() === 0);
  lookupResult = resolved();
  const changed = await addContactProperty(ctx, contactId, { mlsNumber: "A000123", expectedDataset: "synthetic_mls", expectedListingId: "stale-key" }, provider, now);
  check("add revalidates expected listing identity before writing", !changed.ok && changed.reason === "listing_changed" && await count() === 0);
  const added = await addContactProperty(ctx, contactId, { mlsNumber: "a000123", expectedDataset: "synthetic_mls", expectedListingId: "listing-1" }, provider, now);
  check("reviewed add persists a reference and returns fresh listing", added.ok && added.value.syncStatus === "available" && added.value.listing?.listPrice === 795_000 && await count() === 1 && await auditCount() === 1);
  const [stored] = await db.select().from(contactProperties);
  check("storage contains no MLS display/media snapshot", Object.keys(stored).sort().join() === "contactId,createdAt,createdByUserId,dataset,id,listingId,mlsNumber,removedAt" && !JSON.stringify(stored).includes("Synthetic property"));
  const [parent] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  check("saving property does not invent contact or change parent revision", parent.updatedAt.toISOString() === now.toISOString() && parent.lastContactAt === null);
  const again = await addContactProperty(ctx, contactId, { mlsNumber: "A000123", expectedDataset: "synthetic_mls", expectedListingId: "listing-1" }, provider, now);
  check("duplicate live add is idempotent without duplicate audit", again.ok && again.value.id === added.value.id && await count() === 1 && await auditCount() === 1);
  check("subsequent lookup reports already saved", (await lookupContactProperty(ctx, contactId, { mlsNumber: "A000123" }, provider) as { ok: true; value: { alreadySaved: boolean } }).value.alreadySaved);
  const audit = (await db.select().from(auditEvents))[0];
  check("audit contains IDs and action only", Object.keys(audit.safeMetadata!).sort().join() === "action,contactId,propertyId" && audit.safeMetadata?.action === "add" && !JSON.stringify(audit.safeMetadata).includes("A000123"));

  getResult = resolved("listing-1", "A000123", 765_000);
  const beforeListLookup = lookupCalls;
  const fresh = await getContactProperties(reader, contactId, provider, {}, new Date(now.getTime() + 1000));
  check("read-only reader can refresh current MLS data", fresh.ok && fresh.value.items[0].listing?.listPrice === 765_000 && fresh.value.items[0].checkedAt === new Date(now.getTime() + 1000).toISOString());
  check("refresh uses saved keys, not matching/search", lookupCalls === beforeListLookup && getCalls === 1);
  for (const reason of ["not_found", "unavailable", "not_configured", "ambiguous"] as const) {
    getResult = { ok: false, reason };
    const page = await getContactProperties(ctx, contactId, provider);
    check("missing/outage retains reference with honest unavailable state", page.ok && page.value.total === 1 && page.value.items[0].id === added.value.id && page.value.items[0].listing === null && page.value.items[0].syncStatus === (reason === "ambiguous" ? "unavailable" : reason) && await count() === 1);
  }
  getResult = resolved("different-listing", "A000123");
  const replacement = await getContactProperties(ctx, contactId, provider);
  check("refresh never silently attaches a different durable listing", replacement.ok && replacement.value.items[0].listing === null && replacement.value.items[0].syncStatus === "not_found");
  const malformed = await getContactProperties(ctx, contactId, { ...provider, get: async () => ({ ok: true, value: null }) as unknown as PropertyResolution });
  check("malformed provider result degrades only the row without losing its reference", malformed.ok && malformed.value.total === 1 && malformed.value.items[0].syncStatus === "unavailable" && malformed.value.items[0].listing === null);
  check("another contact cannot remove this row", !(await removeContactProperty(ctx, secondId, added.value.id)).ok);
  check("read-only member cannot remove", !(await removeContactProperty(reader, contactId, added.value.id)).ok);
  const removed = await removeContactProperty(ctx, contactId, added.value.id, now);
  check("remove is soft and audited atomically", removed.ok && (await db.select().from(contactProperties))[0].removedAt !== null && await auditCount() === 2);
  check("already removed is idempotent without another audit", (await removeContactProperty(ctx, contactId, added.value.id, now)).ok && await auditCount() === 2);
  check("removed rows are absent from refreshed page", (await getContactProperties(ctx, contactId, provider) as { ok: true; value: { total: number } }).value.total === 0);
  const readded = await addContactProperty(ctx, contactId, { mlsNumber: "A000123", expectedDataset: "synthetic_mls", expectedListingId: "listing-1" }, provider, now);
  check("re-add makes a new live row while preserving removed history", readded.ok && readded.value.id !== added.value.id && await count() === 2);

  // Pagination and fixed provider fan-out; equal timestamps sort by stable IDs.
  await db.insert(contactProperties).values(Array.from({ length: 25 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, contactId: secondId, dataset: "synthetic_mls", listingId: `page-key-${i}`, mlsNumber: `P${i}`, createdAt: now, createdByUserId: actor.userId })));
  let inFlight = 0, maxFlight = 0, pageGets = 0;
  const pageProvider: PropertyMlsProvider = { lookup: async () => { throw new Error("List must not search"); }, get: async (dataset, id, number) => {
    pageGets++; inFlight++; maxFlight = Math.max(maxFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 1)); inFlight--;
    return { ok: true, value: { dataset, listing: listing(id, number) } };
  } };
  const first = await getContactProperties(ctx, secondId, pageProvider);
  check("first page contains12 of25 saved references", first.ok && first.value.total === 25 && first.value.items.length === 12 && first.value.page === 1);
  const third = await getContactProperties(ctx, secondId, pageProvider, { page: 99 });
  check("out-of-range page clamps to the last real page", third.ok && third.value.page === 3 && third.value.items.length === 1);
  const maxPage = await getContactProperties(ctx, secondId, pageProvider, { pageSize: 24 });
  check("provider requests are bounded to page size and at most4 concurrent", maxPage.ok && maxPage.value.items.length === 24 && maxFlight === 4 && pageGets === 37);
  check("tied saved times have deterministic order", first.ok && first.value.items[0].id === "00000000-0000-4000-8000-000000000025");
  const callsBeforeInvalid = pageGets;
  check("service enforces page bounds independently", !(await getContactProperties(ctx, secondId, pageProvider, { pageSize: 25 })).ok && pageGets === callsBeforeInvalid);

  // A failed audit rolls back both add and remove, including their CTE write.
  await pg.exec("create function fail_property_audit() returns trigger language plpgsql as $$begin raise exception 'local synthetic audit failure'; end$$; create trigger property_audit_failure before insert on audit_events for each row execute function fail_property_audit()");
  lookupResult = resolved("atomic-key", "A444");
  const countBeforeFailure = await count();
  const failedAdd = await addContactProperty(ctx, contactId, { mlsNumber: "A444", expectedDataset: "synthetic_mls", expectedListingId: "atomic-key" }, provider, now);
  check("audit failure rolls back saved reference", !failedAdd.ok && failedAdd.reason === "unavailable" && await count() === countBeforeFailure);
  const failedRemove = await removeContactProperty(ctx, contactId, readded.value.id, now);
  check("audit failure rolls back soft removal", !failedRemove.ok && failedRemove.reason === "unavailable" && (await db.select().from(contactProperties).where(eq(contactProperties.id, readded.value.id)))[0].removedAt === null);
  await pg.exec("drop trigger property_audit_failure on audit_events; drop function fail_property_audit()");

  const raceId = randomUUID(); await db.insert(contacts).values({ id: raceId, assignedAgentUserId: actor.userId, firstName: "Race original" });
  const raceProvider: PropertyMlsProvider = { ...provider, lookup: async () => {
    await db.update(contacts).set({ stage: "archived", mergedIntoContactId: contactId, mergedAt: now }).where(eq(contacts.id, raceId)); return resolved("race-key", "R333");
  } };
  const raced = await addContactProperty(ctx, raceId, { mlsNumber: "R333", expectedDataset: "synthetic_mls", expectedListingId: "race-key" }, raceProvider, now);
  check("a merge during lookup causes conflict instead of adding to stale parent", !raced.ok && raced.reason === "conflict" && !(await db.select().from(contactProperties)).some(row => row.listingId === "race-key"));
  const raceRemoveId = randomUUID(), racePropertyId = randomUUID();
  await db.insert(contacts).values({ id: raceRemoveId, assignedAgentUserId: actor.userId, firstName: "Race remove original" });
  await db.insert(contactProperties).values({ id: racePropertyId, contactId: raceRemoveId, dataset: "synthetic_mls", listingId: "race-remove", mlsNumber: "R444" });
  const raceDb = beforeBatch(async () => {
    await db.update(contactProperties).set({ contactId }).where(eq(contactProperties.id, racePropertyId));
    await db.update(contacts).set({ stage: "archived", mergedIntoContactId: contactId, mergedAt: now }).where(eq(contacts.id, raceRemoveId));
  });
  const racedRemove = await removeContactProperty({ actor, db: raceDb }, raceRemoveId, racePropertyId, now);
  check("a merge before remove cannot falsely report removing the canonical row", !racedRemove.ok && racedRemove.reason === "conflict" && (await db.select().from(contactProperties).where(eq(contactProperties.id, racePropertyId)))[0].removedAt === null);
  const lateId = randomUUID();
  await db.insert(contactProperties).values({ id: lateId, contactId: raceId, dataset: "synthetic_mls", listingId: "late-key", mlsNumber: "L123" });
  check("canonical trigger keeps late property reference on retained contact", (await db.select().from(contactProperties).where(eq(contactProperties.id, lateId)))[0].contactId === contactId);
  let uniqueRejected = false;
  try { await db.insert(contactProperties).values({ contactId, dataset: "synthetic_mls", listingId: "listing-1", mlsNumber: "A000123" }); } catch { uniqueRejected = true; }
  check("database prevents a second live contact+dataset+key reference", uniqueRejected);
  for (const bad of [{ dataset: "bad dataset", listingId: "valid", mlsNumber: "A123" }, { dataset: "synthetic", listingId: " ", mlsNumber: "A123" }, { dataset: "synthetic", listingId: "valid", mlsNumber: "abc" }]) {
    let rejected = false; try { await db.insert(contactProperties).values({ contactId, ...bad }); } catch { rejected = true; }
    check("database checks preserve the normalized reference shape", rejected);
  }
  check("all active row counts remain visible only through scoped parent", !(await getContactProperties({ actor: other, db }, contactId, pageProvider)).ok);
  console.log(`${passed}/${passed} contact property checks passed (isolated PostgreSQL and fake MLS; no live access)`);
} finally { await pg.close(); }
