/** Research, transfer and global ordering against isolated PostgreSQL; MLS is entirely fake. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contacts, contactProperties, dashboardUsers, propertyLists, propertyTransferRequests } from "../lib/db/schema.ts";
import type { Db } from "../lib/db/client.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import type { Listing } from "../lib/data/types.ts";
import { createPropertyList } from "../lib/contacts/property-lists-service.ts";
import { addPropertyListProperty, getPropertyListProperties, getPropertyListProperty, removePropertyListProperty } from "../lib/contacts/properties-service.ts";
import { updatePropertyResearch, transferProperty } from "../lib/contacts/property-research-service.ts";
import { propertyResearchInputSchema, propertyTransferInputSchema, applyPropertyPriceOrder, comparePropertyAdded } from "../lib/contacts/property-research.ts";
import { readPropertyQuery, type PropertyMlsProvider } from "../lib/contacts/properties.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-11-02T15:00:00.000Z");
const initial = { notes: "", reviewStatus: "to_review" as const, expectedUpdatedAt: now.toISOString() };
check("research preserves whitespace, newlines and literal markup", propertyResearchInputSchema.parse({ ...initial, notes: "  Private\n<script>literal</script>  " }).notes === "  Private\n<script>literal</script>  ");
check("exact5000-character note accepted and5001 refused", propertyResearchInputSchema.safeParse({ ...initial, notes: "x".repeat(5000) }).success && !propertyResearchInputSchema.safeParse({ ...initial, notes: "x".repeat(5001) }).success);
for (const patch of [{ ...initial, notes: "bad\0" }, { ...initial, reviewStatus: "maybe" }, { notes: "Missing revision", reviewStatus: "to_review" }, { ...initial, ownerUserId: randomUUID() }]) check("invalid research is refused", !propertyResearchInputSchema.safeParse(patch).success);
check("transfer needs immutable UUID request and explicit expected revision", !propertyTransferInputSchema.safeParse({ mode: "copy", targetListId: randomUUID() }).success);
for (const query of ["reviewStatus=bad", "sort=price", "notes=private", "pageSize=25"]) check("invalid research query refused", readPropertyQuery(new URLSearchParams(query)) === null);
check("filter/sort parse explicitly", readPropertyQuery(new URLSearchParams("reviewStatus=shortlisted&sort=price_asc"))?.reviewStatus === "shortlisted");
check("malformed global order cannot omit or repeat memberships", applyPropertyPriceOrder([{ id: "a" }, { id: "b" }], ["a"]) === null && applyPropertyPriceOrder([{ id: "a" }, { id: "b" }], ["a", "a"]) === null && applyPropertyPriceOrder([{ id: "a" }], ["other"]) === null);
check("date ties use stable identifiers", comparePropertyAdded({ id: "b", addedAt: now.toISOString() }, { id: "a", addedAt: now.toISOString() }) < 0);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" };
const ctx: Ctx = { actor, db }, reader: Ctx = { actor: { ...actor, role: "member" }, db };
let feedCalls = 0;
const makeListing = (id: string, number: string): Listing => ({ id, mlsNumber: number, source: "mls", address: "Synthetic property", city: "Sample", zip: "00000", status: "active", propertyType: "condo", listPrice: 100, beds: 1, baths: 1, sqft: 1, listedDate: now.toISOString(), agentId: "", photos: [], description: "", priceHistory: [] });
const provider: PropertyMlsProvider = { lookup: async number => { feedCalls++; return { ok: true, value: { dataset: "synthetic", listing: makeListing(number, number) } }; }, get: async (dataset, id, number) => { feedCalls++; return { ok: true, value: { dataset, listing: makeListing(id, number) } }; } };
async function list(name: string, contactId?: string, context = ctx) { const result = await createPropertyList(context, { requestId: randomUUID(), name, ...(contactId ? { contactId } : {}) }, now); check("synthetic list creates", result.ok); return result.value; }
async function save(listId: string, number: string) { const result = await addPropertyListProperty(ctx, listId, { mlsNumber: number, expectedDataset: "synthetic", expectedListingId: number }, provider, now); check("synthetic reference saves", result.ok); return result.value; }
function beforeBatch(work: () => Promise<void>, after = false): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) { if (property === "batch") return async (writes: Parameters<Db["batch"]>[0]) => { if (pending && !after) { pending = false; await work(); } const result = await target.batch(writes); if (pending && after) { pending = false; await work(); } return result; }; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
}
async function receipts() { return (await db.select().from(propertyTransferRequests)).length; }
async function audits() { return (await db.select().from(auditEvents)).length; }
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_research_${index}`, primaryEmail: `research${index}@example.test`, status: "active" as const })));
  const source = await list("Research source"), target = await list("Research target"), third = await list("Concurrent target"), fourth = await list("Move target"), otherList = await list("Other owner", undefined, { actor: other, db });
  const property = await save(source.id, "A123"), beforeFeed = feedCalls;
  const input = { notes: "  Private research\n<script>literal text</script>  ", reviewStatus: "shortlisted" as const, expectedUpdatedAt: property.updatedAt };
  const changed = await updatePropertyResearch(ctx, source.id, property.id, input, now);
  check("research saves private exact text/status and advances revision", changed.ok && changed.value.notes === input.notes && changed.value.reviewStatus === "shortlisted" && changed.value.updatedAt !== property.updatedAt);
  check("research response is usable offline with no fake MLS result", changed.ok && changed.value.listing === null && changed.value.checkedAt === null && feedCalls === beforeFeed);
  const afterResearchAudit = await audits();
  const retry = await updatePropertyResearch(ctx, source.id, property.id, input, now);
  check("lost-response research retry acknowledges identical state without another audit", retry.ok && changed.ok && retry.value.updatedAt === changed.value.updatedAt && await audits() === afterResearchAudit);
  const stale = await updatePropertyResearch(ctx, source.id, property.id, { ...input, notes: "Stale overwrite" }, now);
  check("stale changed research never overwrites latest", !stale.ok && stale.reason === "conflict" && (await getPropertyListProperty(ctx, source.id, property.id) as { ok: true; value: { notes: string } }).value.notes === input.notes);
  const fresh = await getPropertyListProperty(reader, source.id, property.id);
  check("unfiltered single read is available to read-only owner", fresh.ok && fresh.value.notes === input.notes && fresh.value.updatedAt === changed.value.updatedAt);
  check("members cannot save research", !(await updatePropertyResearch(reader, source.id, property.id, input, now)).ok);
  check("admin cannot read or mutate another owner's research", !(await getPropertyListProperty({ actor: admin, db }, source.id, property.id)).ok && !(await updatePropertyResearch({ actor: admin, db }, source.id, property.id, input, now)).ok);
  const saveLostInput = { ...input, notes: "Recovered research response", expectedUpdatedAt: changed.value.updatedAt };
  const lostSave = await updatePropertyResearch({ actor, db: beforeBatch(async () => { throw new Error("Synthetic lost research response"); }, true) }, source.id, property.id, saveLostInput, now);
  check("post-commit research response failure recovers without a rewrite", lostSave.ok && lostSave.value.notes === saveLostInput.notes);
  const sourceSnapshot = (await getPropertyListProperty(ctx, source.id, property.id) as { ok: true; value: typeof property }).value;
  const copyInput = { requestId: randomUUID(), mode: "copy" as const, targetListId: target.id, expectedUpdatedAt: sourceSnapshot.updatedAt };
  const copied = await transferProperty(ctx, source.id, property.id, copyInput, now);
  check("copy creates new membership with private metadata preserved", copied.ok && !copied.value.sourceRemoved && copied.value.property.id !== property.id && copied.value.property.notes === sourceSnapshot.notes && copied.value.property.reviewStatus === sourceSnapshot.reviewStatus && copied.value.property.listId === target.id);
  check("copy leaves source membership and revision unchanged", (await getPropertyListProperty(ctx, source.id, property.id) as { ok: true; value: typeof property }).value.updatedAt === sourceSnapshot.updatedAt);
  const independent = await updatePropertyResearch(ctx, target.id, copied.value.property.id, { notes: "Independent target research", reviewStatus: "ruled_out", expectedUpdatedAt: copied.value.property.updatedAt }, now);
  check("research remains independent per list membership", independent.ok && (await getPropertyListProperty(ctx, source.id, property.id) as { ok: true; value: typeof property }).value.notes === sourceSnapshot.notes);
  const duplicate = await transferProperty(ctx, source.id, property.id, { ...copyInput, requestId: randomUUID(), mode: "move" }, now);
  check("duplicate target refuses without deleting source or overwriting target metadata", !duplicate.ok && duplicate.reason === "target_has_property" && (await getPropertyListProperty(ctx, source.id, property.id)).ok && (await getPropertyListProperty(ctx, target.id, copied.value.property.id) as { ok: true; value: typeof property }).value.notes === "Independent target research");
  const sameList = await transferProperty(ctx, source.id, property.id, { ...copyInput, requestId: randomUUID(), targetListId: source.id }, now);
  check("same-list transfer is explicitly invalid", !sameList.ok && sameList.reason === "invalid_property_transfer");
  check("other-owner target denied before any feed operation", !(await transferProperty(ctx, source.id, property.id, { ...copyInput, requestId: randomUUID(), targetListId: otherList.id }, now)).ok && feedCalls === beforeFeed);
  check("members cannot transfer or replay a prior operation", !(await transferProperty(reader, source.id, property.id, copyInput, now)).ok);
  const concurrentInput = { ...copyInput, requestId: randomUUID(), targetListId: third.id };
  const concurrent = await Promise.all([transferProperty(ctx, source.id, property.id, concurrentInput, now), transferProperty(ctx, source.id, property.id, concurrentInput, now)]);
  check("concurrent identical copy returns one target and durable receipt", concurrent.every(result => result.ok) && concurrent[0].ok && concurrent[1].ok && concurrent[0].value.property.id === concurrent[1].value.property.id && await receipts() === 2);
  const movedInput = { ...copyInput, requestId: randomUUID(), mode: "move" as const, targetListId: fourth.id };
  const moved = await transferProperty({ actor, db: beforeBatch(async () => { throw new Error("Synthetic lost move response"); }, true) }, source.id, property.id, movedInput, now);
  check("lost move response recovers exact target without duplicating membership", moved.ok && moved.value.sourceRemoved && moved.value.property.listId === fourth.id && await receipts() === 3);
  check("move soft-removes source and leaves independent copy untouched", !(await getPropertyListProperty(ctx, source.id, property.id)).ok && (await db.select().from(contactProperties).where(eq(contactProperties.id, property.id)))[0].removedAt !== null && (await getPropertyListProperty(ctx, target.id, copied.value.property.id)).ok);
  const changedPayload = await transferProperty(ctx, source.id, property.id, { ...movedInput, mode: "copy" }, now);
  check("changed transfer payload cannot reuse receipt", !changedPayload.ok && changedPayload.reason === "request_conflict");
  const removedTarget = await removePropertyListProperty(ctx, fourth.id, moved.value.property.id, now, moved.value.property.updatedAt); check("target removal fixture succeeds", removedTarget.ok);
  const afterRemovalReplay = await transferProperty(ctx, source.id, property.id, movedInput, now);
  check("replay cannot recreate a subsequently removed target", !afterRemovalReplay.ok && afterRemovalReplay.reason === "conflict" && await receipts() === 3);
  await db.update(propertyLists).set({ ownerUserId: other.userId }).where(eq(propertyLists.id, target.id));
  const revokedReplay = await transferProperty(ctx, source.id, property.id, copyInput, now);
  check("receipt replay reauthorizes both current private lists", !revokedReplay.ok && revokedReplay.reason === "not_found");

  const raceSource = await list("Race source"), raceTarget = await list("Race target"), raceProperty = await save(raceSource.id, "R123");
  const raceInput = { requestId: randomUUID(), mode: "move" as const, targetListId: raceTarget.id, expectedUpdatedAt: raceProperty.updatedAt };
  const raceDb = beforeBatch(async () => { await db.update(propertyLists).set({ ownerUserId: other.userId }).where(eq(propertyLists.id, raceTarget.id)); await db.insert(contactProperties).values({ listId: raceTarget.id, contactId: null, dataset: "synthetic", listingId: "R123", mlsNumber: "R123", notes: "Hidden target metadata" }); });
  const revokedRace = await transferProperty({ actor, db: raceDb }, raceSource.id, raceProperty.id, raceInput, now);
  check("catch rechecks target owner before reporting duplicate existence", !revokedRace.ok && revokedRace.reason === "not_found" && (await getPropertyListProperty(ctx, raceSource.id, raceProperty.id)).ok && !(await db.select().from(propertyTransferRequests)).some(row => row.requestId === raceInput.requestId));
  const contactId = randomUUID(); await db.insert(contacts).values({ id: contactId, assignedAgentUserId: actor.userId, firstName: "Visibility race" });
  const contactTarget = await list("Contact target", contactId);
  const contactRaceInput = { ...raceInput, requestId: randomUUID(), targetListId: contactTarget.id };
  const contactRaceDb = beforeBatch(async () => { await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, contactId)); await db.insert(contactProperties).values({ listId: contactTarget.id, contactId, dataset: "synthetic", listingId: "R123", mlsNumber: "R123" }); });
  const contactRace = await transferProperty({ actor, db: contactRaceDb }, raceSource.id, raceProperty.id, contactRaceInput, now);
  check("catch rechecks linked contact access before reporting duplicate existence", !contactRace.ok && contactRace.reason === "not_found" && (await getPropertyListProperty(ctx, raceSource.id, raceProperty.id)).ok);

  const staleRemoval = await updatePropertyResearch(ctx, raceSource.id, raceProperty.id, { notes: "Newer note before remove", reviewStatus: "shortlisted", expectedUpdatedAt: raceProperty.updatedAt }, now); check("removal revision fixture saves", staleRemoval.ok);
  const refusedRemoval = await removePropertyListProperty(ctx, raceSource.id, raceProperty.id, now, raceProperty.updatedAt);
  check("stale remove cannot discard newer research", !refusedRemoval.ok && refusedRemoval.reason === "conflict" && (await getPropertyListProperty(ctx, raceSource.id, raceProperty.id)).ok);
  const casTarget = await list("CAS target"), staleTransfer = await transferProperty(ctx, raceSource.id, raceProperty.id, { ...raceInput, requestId: randomUUID(), targetListId: casTarget.id }, now);
  check("stale transfer cannot copy an outdated research snapshot", !staleTransfer.ok && staleTransfer.reason === "conflict");
  const injectedCasInput = { requestId: randomUUID(), mode: "move" as const, targetListId: casTarget.id, expectedUpdatedAt: staleRemoval.value.updatedAt };
  const casDb = beforeBatch(async () => { const saved = await updatePropertyResearch(ctx, raceSource.id, raceProperty.id, { notes: "Injected latest research", reviewStatus: "to_review", expectedUpdatedAt: staleRemoval.value.updatedAt }, now); assert.ok(saved.ok); });
  const injectedCas = await transferProperty({ actor, db: casDb }, raceSource.id, raceProperty.id, injectedCasInput, now);
  check("receipt guard catches research changed after preflight with no partial move", !injectedCas.ok && injectedCas.reason === "conflict" && (await getPropertyListProperty(ctx, raceSource.id, raceProperty.id) as { ok: true; value: typeof property }).value.notes === "Injected latest research" && !(await db.select().from(contactProperties)).some(row => row.listId === casTarget.id));
  const beforeRemoveRace = await getPropertyListProperty(ctx, raceSource.id, raceProperty.id); check("remove race revision is current", beforeRemoveRace.ok);
  const removeRaceDb = beforeBatch(async () => { const saved = await updatePropertyResearch(ctx, raceSource.id, raceProperty.id, { notes: "Latest note during remove", reviewStatus: "shortlisted", expectedUpdatedAt: beforeRemoveRace.value.updatedAt }, now); assert.ok(saved.ok); });
  const removeRace = await removePropertyListProperty({ actor, db: removeRaceDb }, raceSource.id, raceProperty.id, now, beforeRemoveRace.value.updatedAt);
  check("remove CAS rechecks after preflight instead of falsely reporting success", !removeRace.ok && removeRace.reason === "conflict" && (await getPropertyListProperty(ctx, raceSource.id, raceProperty.id) as { ok: true; value: typeof property }).value.notes === "Latest note during remove");

  const atomicSource = await list("Atomic source"), atomicTarget = await list("Atomic target"), atomicProperty = await save(atomicSource.id, "T123");
  const beforeReceipts = await receipts(), beforeRows = (await db.select().from(contactProperties)).length;
  await pg.exec("create function fail_research_audit() returns trigger language plpgsql as $$begin raise exception 'local synthetic failure'; end$$; create trigger research_audit_failure before insert on audit_events for each row execute function fail_research_audit()");
  const failedSave = await updatePropertyResearch(ctx, atomicSource.id, atomicProperty.id, { notes: "Should roll back", reviewStatus: "ruled_out", expectedUpdatedAt: atomicProperty.updatedAt }, now);
  check("failed research audit rolls back text/status/version", !failedSave.ok && (await getPropertyListProperty(ctx, atomicSource.id, atomicProperty.id) as { ok: true; value: typeof property }).value.notes === "");
  const failedMove = await transferProperty(ctx, atomicSource.id, atomicProperty.id, { requestId: randomUUID(), mode: "move", targetListId: atomicTarget.id, expectedUpdatedAt: atomicProperty.updatedAt }, now);
  check("failed transfer audit rolls back receipt,target and source removal", !failedMove.ok && await receipts() === beforeReceipts && (await db.select().from(contactProperties)).length === beforeRows && (await getPropertyListProperty(ctx, atomicSource.id, atomicProperty.id)).ok);
  await pg.exec("drop trigger research_audit_failure on audit_events; drop function fail_research_audit()");
  const serializedAudit = JSON.stringify((await db.select().from(auditEvents)).map(row => row.safeMetadata));
  const serializedReceipts = JSON.stringify((await db.select().from(propertyTransferRequests)).map(row => row.result));
  check("audit and receipt never contain private research text", !/Private research|literal text|Independent target research|Injected latest|Recovered research|Hidden target/.test(serializedAudit + serializedReceipts));

  const filterList = await list("Filter and global price"), statuses = ["to_review", "shortlisted", "ruled_out"] as const;
  const filterRows = Array.from({ length: 29 }, (_, i) => ({ id: randomUUID(), listId: filterList.id, contactId: null, dataset: "synthetic", listingId: `filter-key-${i}`, mlsNumber: `F${String(i).padStart(3, "0")}`, createdAt: new Date(now.getTime() + i), updatedAt: now, notes: `Private filter note ${i}`, reviewStatus: statuses[i % 3], removedAt: i === 0 ? now : null }));
  await db.insert(contactProperties).values(filterRows);
  const filtered = await getPropertyListProperties(ctx, filterList.id, provider, { reviewStatus: "shortlisted", pageSize: 4, page: 2, sort: "added_desc" });
  check("status filter is applied before page/count with unfiltered total available", filtered.ok && filtered.value.total === 10 && filtered.value.totalAll === 28 && filtered.value.items.length === 4 && filtered.value.items.map(row => row.mlsNumber).join() === "F016,F013,F010,F007");
  const ascending = await getPropertyListProperties(ctx, filterList.id, provider, { sort: "added_asc", pageSize: 1 });
  check("addedascending order is global and removed rows excluded", ascending.ok && ascending.value.items[0].mlsNumber === "F001");
  let priceRefs: { id: string; dataset: string; listingId: string }[] = [];
  const priceProvider: PropertyMlsProvider = { ...provider, orderByPrice: async (refs, direction) => {
    priceRefs = refs;
    const price = (key: string) => { const i = Number(key.slice("filter-key-".length)); return i === 5 || i === 10 ? null : i; };
    const ordered = [...refs].sort((a, b) => { const x = price(a.listingId), y = price(b.listingId); return x === null ? y === null ? 0 : 1 : y === null ? -1 : direction === "asc" ? x - y : y - x; });
    return { ok: true, ids: ordered.map(row => row.id) };
  } };
  const low = await getPropertyListProperties(ctx, filterList.id, priceProvider, { sort: "price_asc", pageSize: 4 });
  check("price sort covers all filtered references before paginating", low.ok && priceRefs.length === 28 && low.value.items.map(row => row.mlsNumber).join() === "F001,F002,F003,F004");
  check("price provider receives only scopedreference IDs/dataset/keys", priceRefs.every(ref => Object.keys(ref).sort().join() === "dataset,id,listingId") && !JSON.stringify(priceRefs).includes("Private filter"));
  const high = await getPropertyListProperties(ctx, filterList.id, priceProvider, { sort: "price_desc", pageSize: 4 });
  check("descending price order starts with global highest", high.ok && high.value.items[0].mlsNumber === "F028");
  const tail = await getPropertyListProperties(ctx, filterList.id, priceProvider, { sort: "price_asc", pageSize: 4, page: 7 });
  check("unknown price references remain at stable tail", tail.ok && tail.value.items.slice(-2).map(row => row.mlsNumber).join() === "F010,F005");
  const noOrder = await getPropertyListProperties(ctx, filterList.id, provider, { sort: "price_asc" });
  check("missing global order capability refuses instead of pageonlysorting", !noOrder.ok && noOrder.reason === "unavailable");
  for (const failure of [async () => ({ ok: false as const, reason: "not_configured" as const }), async () => ({ ok: true as const, ids: [filterRows[1].id] }), async () => { throw new Error("Synthetic price failure"); }]) check("failed/partial global order never falls back silently", !(await getPropertyListProperties(ctx, filterList.id, { ...provider, orderByPrice: failure }, { sort: "price_asc" })).ok);
  const oversized = await list("Bounded global refs");
  await db.insert(contactProperties).values(Array.from({ length: 1001 }, (_, i) => ({ listId: oversized.id, contactId: null, dataset: "synthetic", listingId: `large-${i}`, mlsNumber: `L${i}` })));
  let oversizedCalls = 0;
  const bounded = await getPropertyListProperties(ctx, oversized.id, { ...provider, orderByPrice: async () => { oversizedCalls++; return { ok: true, ids: [] }; } }, { sort: "price_asc" });
  check("oversized global sort fails before providerwork", !bounded.ok && bounded.reason === "unavailable" && oversizedCalls === 0);
  console.log(`${passed}/${passed} property research checks passed (isolated PostgreSQL and fake MLS; no live access)`);
} finally { await pg.close(); }
