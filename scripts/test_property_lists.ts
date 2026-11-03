/** Named lists: own-book scope, explicit contact links and durable create retries. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contactProperties, contacts, dashboardUsers, propertyLists } from "../lib/db/schema.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import type { Db } from "../lib/db/client.ts";
import { createPropertyListInputSchema, renamePropertyListInputSchema, readPropertyListsQuery } from "../lib/contacts/property-lists.ts";
import { createPropertyList, getPropertyList, getPropertyLists, renamePropertyList } from "../lib/contacts/property-lists-service.ts";
import { addPropertyListProperty, getPropertyListProperties, lookupPropertyListProperty, removePropertyListProperty, getContactProperties, removeContactProperty } from "../lib/contacts/properties-service.ts";
import type { PropertyMlsProvider } from "../lib/contacts/properties.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-10-30T15:00:00.000Z");
check("create trims a readable list name", createPropertyListInputSchema.parse({ requestId: randomUUID(), name: "  Weekend shortlist  " }).name === "Weekend shortlist");
for (const name of ["", " ", "x".repeat(121), "bad\0name"]) check("unusable list name is refused", !createPropertyListInputSchema.safeParse({ requestId: randomUUID(), name }).success);
check("names exactly at120characters are valid", createPropertyListInputSchema.safeParse({ requestId: randomUUID(), name: "x".repeat(120) }).success);
check("client cannot choose owner or supplied listing data", !createPropertyListInputSchema.safeParse({ requestId: randomUUID(), name: "List", ownerUserId: randomUUID() }).success);
check("create needs a stable UUID retry key", !createPropertyListInputSchema.safeParse({ name: "List" }).success);
check("rename requires observed revision", !renamePropertyListInputSchema.safeParse({ name: "Renamed" }).success);
for (const query of ["page=0", "pageSize=25", "contactId=bad", "q=private", "ownerUserId=x"]) check("invalid/broad list query is refused", readPropertyListsQuery(new URLSearchParams(query)) === null);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" };
const ctx: Ctx = { actor, db }, adminCtx: Ctx = { actor: admin, db }, reader: Ctx = { actor: { ...actor, role: "member" }, db };
let providerCalls = 0;
const provider: PropertyMlsProvider = { lookup: async mlsNumber => { providerCalls++; return { ok: true, value: { dataset: "synthetic", listing: { id: "same-key", mlsNumber, source: "mls", address: "Synthetic home", city: "Sample", zip: "00000", status: "active", propertyType: "condo", listPrice: 100, beds: 1, baths: 1, sqft: 1, listedDate: now.toISOString(), agentId: "", photos: [], description: "", priceHistory: [] } } }; }, get: async (_dataset, _id, mlsNumber) => provider.lookup(mlsNumber) };
const addInput = { mlsNumber: "A123", expectedDataset: "synthetic", expectedListingId: "same-key" };
async function create(name: string, contactId?: string, context = ctx, requestId = randomUUID()) { const result = await createPropertyList(context, { requestId, name, ...(contactId ? { contactId } : {}) }, now); check("list creates", result.ok); return result.value; }
function beforeBatch(work: () => Promise<void>, after = false): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) {
    if (property === "batch") return async (writes: Parameters<Db["batch"]>[0]) => { if (pending && !after) { pending = false; await work(); } const result = await target.batch(writes); if (pending && after) { pending = false; await work(); } return result; };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_named_list_${index}`, primaryEmail: `list${index}@example.test`, status: "active" as const })));
  const contactId = randomUUID(), otherContactId = randomUUID();
  await db.insert(contacts).values([{ id: contactId, assignedAgentUserId: actor.userId, firstName: "Own contact" }, { id: otherContactId, assignedAgentUserId: other.userId, firstName: "Other contact" }]);
  const personal = await create("Weekend shortlist"), linked = await create("Buyer shortlist", contactId), another = await create("Buyer shortlist", contactId);
  check("personal list has no invented contact association", personal.contactId === null && personal.propertyCount === 0);
  check("separate lists may use the same name", linked.id !== another.id && linked.name === another.name);
  const all = await getPropertyLists(ctx);
  check("index shows all own visible personal/contact lists", all.ok && all.value.total === 3 && all.value.items.some(item => item.id === personal.id) && all.value.items.some(item => item.contactName === "Own contact"));
  let selectCalls = 0;
  const galleryDb = new Proxy(db, { get(target, property) { const value = Reflect.get(target, property); if (property === "select") return (...args: Parameters<Db["select"]>) => { selectCalls++; return target.select(...args); }; return typeof value === "function" ? value.bind(target) : value; } });
  const batchedGallery = await getPropertyLists({ actor, db: galleryDb });
  check("gallery resolves counts and names in2queries without per-list fanout", batchedGallery.ok && batchedGallery.value.items.length === 3 && selectCalls === 2);
  const filtered = await getPropertyLists(ctx, { contactId });
  check("contact index keeps separate list identities", filtered.ok && filtered.value.total === 2);
  check("invisible contact filter never reveals counts", !(await getPropertyLists(ctx, { contactId: otherContactId })).ok);
  check("agent cannot associate a list with hidden contact", !(await createPropertyList(ctx, { requestId: randomUUID(), name: "Refused", contactId: otherContactId }, now)).ok);
  const adminLinked = await create("Admin private contact context", contactId, adminCtx);
  check("contact visibility allows an admin to create their OWN linked list", adminLinked.contactId === contactId);
  check("admin cannot read another owner's personal or linked list", !(await getPropertyList(adminCtx, personal.id)).ok && !(await getPropertyList(adminCtx, linked.id)).ok);
  check("contact owner cannot read admin's private linked list", !(await getPropertyList(ctx, adminLinked.id)).ok);
  const beforeDenied = providerCalls;
  for (const operation of [lookupPropertyListProperty(adminCtx, linked.id, { mlsNumber: "A123" }, provider), addPropertyListProperty(adminCtx, linked.id, addInput, provider), getPropertyListProperties(adminCtx, linked.id, provider)]) check("other-owner list operation is refused", !(await operation).ok);
  check("owner refusal precedes every MLS call", providerCalls === beforeDenied);
  check("members can read own lists", (await getPropertyList(reader, personal.id)).ok && (await getPropertyLists(reader)).ok);
  check("members cannot create or rename", !(await createPropertyList(reader, { requestId: randomUUID(), name: "No" })).ok && !(await renamePropertyList(reader, personal.id, { name: "No", expectedUpdatedAt: personal.updatedAt })).ok);
  check("members cannot lookup or add to own list", !(await lookupPropertyListProperty(reader, personal.id, { mlsNumber: "A123" }, provider)).ok && !(await addPropertyListProperty(reader, personal.id, addInput, provider)).ok && providerCalls === beforeDenied);

  const first = await addPropertyListProperty(ctx, linked.id, addInput, provider, now), second = await addPropertyListProperty(ctx, another.id, addInput, provider, now), personalItem = await addPropertyListProperty(ctx, personal.id, addInput, provider, now);
  check("same MLS reference can belong to several separate lists", first.ok && second.ok && personalItem.ok && new Set([first.value.id, second.value.id, personalItem.value.id]).size === 3);
  check("personal membership has null contact and explicit list", personalItem.ok && personalItem.value.contactId === null && personalItem.value.listId === personal.id);
  const duplicate = await addPropertyListProperty(ctx, linked.id, addInput, provider, now);
  check("duplicate within one list remains idempotent", duplicate.ok && first.ok && duplicate.value.id === first.value.id);
  check("list counts are membership-specific", (await getPropertyList(ctx, linked.id) as { ok: true; value: { propertyCount: number } }).value.propertyCount === 1);
  check("contact compatibility does not sweep unrelated named lists", (await getContactProperties(ctx, contactId, provider) as { ok: true; value: { total: number } }).value.total === 0);
  check("contact compatibility cannot remove named-list membership", first.ok && !(await removeContactProperty(ctx, contactId, first.value.id)).ok);
  check("removing one membership leaves the other list unchanged", first.ok && (await removePropertyListProperty(ctx, linked.id, first.value.id, now)).ok && (await getPropertyListProperties(ctx, another.id, provider) as { ok: true; value: { total: number } }).value.total === 1);

  const requestId = randomUUID(), request = { requestId, name: "Durable create", contactId };
  const created = await createPropertyList(ctx, request, now), retried = await createPropertyList(ctx, request, now);
  check("identical create retry returns same durable list", created.ok && retried.ok && created.value.id === retried.value.id);
  const changedRequest = await createPropertyList(ctx, { ...request, name: "Changed" }, now);
  check("same retry key cannot create changed payload", !changedRequest.ok && changedRequest.reason === "request_conflict");
  const parallelRequest = { requestId: randomUUID(), name: "Concurrent create" };
  const parallel = await Promise.all([createPropertyList(ctx, parallelRequest, now), createPropertyList(ctx, parallelRequest, now)]);
  check("concurrent identical creates produce one list", parallel.every(result => result.ok) && parallel[0].ok && parallel[1].ok && parallel[0].value.id === parallel[1].value.id);
  const lostRequest = { requestId: randomUUID(), name: "Lost create response" };
  const lost = await createPropertyList({ actor, db: beforeBatch(async () => { throw new Error("Synthetic lost response"); }, true) }, lostRequest, now);
  check("lost create response recovers durable list", lost.ok && (await createPropertyList(ctx, lostRequest, now) as { ok: true; value: { id: string } }).value.id === lost.value.id);
  const rename = await renamePropertyList(ctx, personal.id, { name: "Renamed shortlist", expectedUpdatedAt: (await getPropertyList(ctx, personal.id) as { ok: true; value: { updatedAt: string } }).value.updatedAt }, now);
  check("rename keeps list identity and increments revision", rename.ok && rename.value.id === personal.id && rename.value.name === "Renamed shortlist" && rename.value.updatedAt !== personal.updatedAt);
  const staleRename = await renamePropertyList(ctx, personal.id, { name: "Stale", expectedUpdatedAt: personal.updatedAt }, now);
  check("stale rename refuses without overwriting", !staleRename.ok && staleRename.reason === "conflict");

  await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, contactId));
  const beforeRevoked = providerCalls;
  const retained = await getPropertyList(ctx, linked.id), retainedProperties = await getPropertyListProperties(ctx, linked.id, provider);
  check("own research survives contact reassignment with contact identity redacted", retained.ok && retained.value.contactId === null && !retained.value.contactName && retainedProperties.ok && retainedProperties.value.items.every(item => item.contactId === null) && providerCalls >= beforeRevoked);
  const replayedOwned = await createPropertyList(ctx, request, now);
  check("create replay returns canonical owner research without revealing a reassigned contact", replayedOwned.ok && replayedOwned.value.contactId === null);
  check("global owner index keeps owned lists while contact-specific filters still refuse access", (await getPropertyLists(ctx) as { ok: true; value: { items: { id: string }[] } }).value.items.some(item => item.id === linked.id) && !(await getPropertyLists(ctx, { contactId })).ok);
  check("personal list remains available independently", (await getPropertyList(ctx, personal.id)).ok);
  await db.update(contacts).set({ assignedAgentUserId: actor.userId }).where(eq(contacts.id, contactId));

  const beforeAuditFailure = (await db.select().from(propertyLists)).length;
  await pg.exec("create function fail_list_audit() returns trigger language plpgsql as $$begin raise exception 'local synthetic failure'; end$$; create trigger list_audit_failure before insert on audit_events for each row execute function fail_list_audit()");
  const failed = await createPropertyList(ctx, { requestId: randomUUID(), name: "Must roll back" }, now);
  check("create and receipt roll back if audit fails", !failed.ok && (await db.select().from(propertyLists)).length === beforeAuditFailure);
  const beforeRename = await getPropertyList(ctx, personal.id); check("rename fixture remains readable", beforeRename.ok);
  const failedRename = await renamePropertyList(ctx, personal.id, { name: "Must roll back", expectedUpdatedAt: beforeRename.value.updatedAt }, now);
  check("rename rolls back if audit fails", !failedRename.ok && (await getPropertyList(ctx, personal.id) as { ok: true; value: { name: string } }).value.name === beforeRename.value.name);
  await pg.exec("drop trigger list_audit_failure on audit_events; drop function fail_list_audit()");
  const audit = await db.select().from(auditEvents);
  check("list/property audits contain no list names or MLS identifiers", audit.every(row => !/shortlist|Durable create|Synthetic home|A123|same-key/.test(JSON.stringify(row.safeMetadata))));
  for (const invalid of [
    { listId: personal.id, contactId, dataset: "synthetic", listingId: "invalid-personal", mlsNumber: "P123" },
    { listId: another.id, contactId: otherContactId, dataset: "synthetic", listingId: "invalid-contact", mlsNumber: "P124" },
  ]) { let rejected = false; try { await db.insert(contactProperties).values(invalid); } catch { rejected = true; } check("DB rejects membership/list contact mismatch", rejected); }
  console.log(`${passed}/${passed} named property list checks passed (isolated PostgreSQL and fake MLS; no live access)`);
} finally { await pg.close(); }
