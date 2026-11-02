/** Reviewed merges against real, isolated PostgreSQL. No live settings or network. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contactActivities, contactMergeRequests, contactNeeds, contactNotes, contactOpportunities, contactProperties, propertyLists, savedShowingTours, savedTourStops, showings, contacts, dashboardUsers, professionalProfiles, transactionParties, transactions, type ShowingRow } from "../lib/db/schema.ts";
import { createContact, getContact, contactSnapshot, listContactsPage, changeStage, type Ctx } from "../lib/contacts/service.ts";
import { createContactSchema } from "../lib/contacts/domain.ts";
import { addNote, listNotes } from "../lib/contacts/notes-service.ts";
import { createNeed } from "../lib/contacts/needs-service.ts";
import { getTimelinePage } from "../lib/contacts/history-service.ts";
import { mutateNextAction } from "../lib/contacts/next-action-service.ts";
import { getContactMergeReview, mergeContacts } from "../lib/contacts/merge-service.ts";
import { findExactContactDuplicates } from "../lib/contacts/duplicates-service.ts";
import { type ContactMergeInput, type MergeReview } from "../lib/contacts/merge.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const { pg, db } = await createLocalContactDb();
const OWNER = "11111111-1111-4111-8111-111111111111", ADMIN = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
const ctx: Ctx = { db, actor: { userId: OWNER, role: "agent", brokerageKey: "fortmark" } };
const NOW = new Date("2026-10-29T17:00:00.000Z");
async function make(name: string, owner = OWNER, legacy?: string) {
  const result = await createContact({ ...ctx, actor: { ...ctx.actor, userId: owner } }, createContactSchema.parse({ firstName: name, notes: legacy }));
  check(`created ${name}`, result.ok); return result.value.id;
}
async function review(a: string, b: string, actor = ctx) {
  const result = await getContactMergeReview(actor, a, b); check("authorized same-book review loads", result.ok); return result.value;
}
function input(r: MergeReview, choice: ContactMergeInput["nextActionChoice"] = "none"): ContactMergeInput {
  return { requestId: randomUUID(), primaryId: r.primary.id, duplicateId: r.duplicate.id,
    expectedPrimaryUpdatedAt: r.primary.updatedAt, expectedDuplicateUpdatedAt: r.duplicate.updatedAt,
    expectedPrimaryHistoryFingerprint: r.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: r.duplicate.historyFingerprint,
    choices: { ...r.defaults }, nextActionChoice: choice };
}
async function pending(id: string, kind: "call" | "email", purpose: string) {
  const contact = await getContact(ctx, id); check("pending fixture has a revision", contact?.updatedAt);
  const result = await mutateNextAction(ctx, id, { action: "set", expectedUpdatedAt: contact.updatedAt, expectedActionId: null,
    next: { kind, purpose, dueAt: "2027-01-04T15:00:00.000Z", assigneeId: OWNER } }, NOW);
  check("pending fixture saves", result.ok); return result.value.nextAction!;
}

try {
  await db.insert(dashboardUsers).values([
    { id: OWNER, clerkUserId: "synthetic_merge_owner", primaryEmail: "owner@example.test", role: "agent", status: "active" },
    { id: ADMIN, clerkUserId: "synthetic_merge_admin", primaryEmail: "admin@example.test", role: "admin", status: "active" },
    { id: OTHER, clerkUserId: "synthetic_merge_other", primaryEmail: "other@example.test", role: "agent", status: "active" },
  ]);
  await db.insert(professionalProfiles).values({ userId: OWNER, preferredDisplayName: "Synthetic Owner" });
  const a = await make("Primary contact", OWNER, "Primary legacy reference"), b = await make("Duplicate contact", OWNER, "Duplicate legacy reference");
  await db.update(contacts).set({ email: "primary@example.test", company: "Primary firm", about: "Private primary context", personalDetails: [{ label: "Reference", value: "Primary detail" }], tags: ["VIP"], lastContactAt: new Date("2026-09-01T14:00:00.000Z"), createdAt: new Date("2026-08-01T14:00:00.000Z") }).where(eq(contacts.id, a));
  await db.update(contacts).set({ email: "old-alias@example.test", company: "Duplicate firm", about: "Private duplicate context", personalDetails: [{ label: "Reference", value: "Duplicate detail" }], tags: ["Referral"], lastContactAt: new Date("2026-10-01T14:00:00.000Z"), createdAt: new Date("2026-07-01T14:00:00.000Z") }).where(eq(contacts.id, b));
  const noteA = await addNote(ctx, a, { body: "Primary note body" }, NOW), noteB = await addNote(ctx, b, { body: "Duplicate note body" }, NOW);
  check("both note fixtures saved", noteA.ok && noteB.ok);
  const needA = await createNeed(ctx, a, { kind: "buy", areas: ["Area A"] }, NOW), needB = await createNeed(ctx, b, { kind: "sell", areas: ["Area B"] }, NOW);
  check("both need fixtures saved", needA.ok && needB.ok);
  const visibleDeal = randomUUID(), hiddenDeal = randomUUID();
  await db.insert(transactions).values([
    { id: visibleDeal, agentUserId: OWNER, transactionType: "residential_sale", side: "buyer", addressLine1: "Synthetic visible deal", city: "Sample" },
    { id: hiddenDeal, agentUserId: OTHER, transactionType: "residential_sale", side: "listing", addressLine1: "Synthetic hidden deal", city: "Sample" },
  ]);
  await db.insert(transactionParties).values([
    { contactId: a, transactionId: visibleDeal, role: "buyer", displayName: "Original primary party" },
    { contactId: b, transactionId: visibleDeal, role: "buyer", displayName: "Original duplicate party" },
    { contactId: b, transactionId: hiddenDeal, role: "seller", displayName: "Original hidden party" },
  ]);
  await db.insert(contactOpportunities).values({ contactId: b, kind: "seller", area: "Original opportunity", transactionId: hiddenDeal });
  const actionA = await pending(a, "call", "Private primary task"), actionB = await pending(b, "email", "Private duplicate task");
  const before = await review(a, b), d = input(before, "primary"); d.choices.company = "duplicate";
  check("review exposes real conflicts rather than a guessed winner", before.conflicts.includes("name") && before.conflicts.includes("email") && before.conflicts.includes("company"));
  check("visible deals deduplicate and hidden transaction existence is not counted", before.primary.counts.transactions === 1 && before.duplicate.counts.transactions === 1 && before.preservedCounts.transactions === 1);
  const merged = await mergeContacts(ctx, d, NOW);
  check("real reviewed merge succeeds", merged.ok);
  check("chosen fields and pending action are retained", merged.value.primary.editable?.company === "Duplicate firm" && merged.value.primary.email === "primary@example.test" && merged.value.primary.nextAction?.id === actionA.id);
  check("a merge keeps the latest actual touch and earliest actual creation", merged.value.primary.lastTouchDate === "2026-10-01T14:00:00.000Z" && merged.value.primary.createdDate === "2026-07-01T14:00:00.000Z");
  const [source] = await db.select().from(contacts).where(eq(contacts.id, b));
  check("source is retained as an archived alias with no competing action", source.mergedIntoContactId === a && source.stage === "archived" && source.nextActionId === null && source.nextFollowUpAt === null && source.mergedAt?.getTime() === NOW.getTime());
  check("original source identity/reference fields are not deleted", source.email === "old-alias@example.test" && source.about === "Private duplicate context");
  const notes = await listNotes(ctx, a); check("all note bodies and unselected legacy reference remain readable", notes.ok && ["Primary note body", "Duplicate note body", "Duplicate legacy reference"].every(body => notes.value.some(note => note.body === body)));
  check("existing note IDs and original timestamps survive", notes.value.some(note => note.id === noteB.value.id && note.createdAt === NOW.toISOString()));
  check("all need IDs/statuses survive", (await db.select().from(contactNeeds).where(eq(contactNeeds.contactId, a))).some(need => need.id === needB.value.id));
  check("opportunities and every party reference move without altering legal party snapshots", (await db.select().from(contactOpportunities).where(eq(contactOpportunities.contactId, a))).some(opportunity => opportunity.transactionId === hiddenDeal) && (await db.select().from(transactionParties).where(eq(transactionParties.contactId, a))).map(party => party.displayName).sort().join() === ["Original primary party", "Original duplicate party", "Original hidden party"].sort().join());
  const activities = await db.select().from(contactActivities).where(eq(contactActivities.contactId, a));
  check("nonselected task is cancelled explicitly with its original context", activities.some(activity => activity.safeMetadata?.event === "next_action_cancelled" && activity.safeMetadata?.actionId === actionB.id && activity.safeMetadata?.purpose === "Private duplicate task"));
  const timeline = await getTimelinePage(ctx, a, { pageSize: 100 });
  check("old source note/need audit history remains in the primary timeline", timeline.ok && timeline.value.items.filter(item => item.title === "Added note").length >= 3 && timeline.value.items.filter(item => item.title === "Client need added").length === 2);
  check("merge has a clear named timeline event", timeline.value.items.some(item => item.title === "Contact files merged"));
  const redirected = await getContact(ctx, b); check("old contact URL resolves to the primary file", redirected?.id === a && redirected.requestedContactId === b);
  check("merged source is absent from all list/snapshot totals", !(await listContactsPage(ctx, {})).items.some(contact => contact.id === b) && (await contactSnapshot(ctx)).total === 1);
  const restore = await changeStage(ctx, b, "lead"); check("old source cannot be restored into a competing visible record", !restore.ok && restore.reason === "not_found");
  const exact = await findExactContactDuplicates(ctx, { email: "old-alias@example.test" });
  check("later imports recognize old alias identifiers as the same primary", exact.ok && exact.value.matches.length === 1 && exact.value.matches[0].contact.id === a);
  const receipts = await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, d.requestId));
  check("receipt stores IDs/counts only, with no client/reference/task values", receipts.length === 1 && !/Private|legacy reference|example.test/.test(JSON.stringify(receipts[0].result)));
  const mergeAudit = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "contact_updated"));
  check("merge audit never contains selected values or task bodies", mergeAudit.filter(event => event.safeMetadata?.event === "contact_merged").every(event => !/Private|example.test|firm/.test(JSON.stringify(event.safeMetadata))));
  const countBeforeRetry = activities.length;
  check("identical retry returns its committed primary", (await mergeContacts(ctx, d, NOW)).ok);
  check("retry creates no extra history or notes", (await db.select().from(contactActivities).where(eq(contactActivities.contactId, a))).length === countBeforeRetry && (await listNotes(ctx, a) as { ok: true; value: unknown[] }).value.length === notes.value.length);
  const reuse = await mergeContacts(ctx, { ...d, nextActionChoice: "none" }, NOW); check("same request ID cannot be reused for different merge choices", !reuse.ok && reuse.reason === "request_conflict");
  const readonly = await mergeContacts({ ...ctx, actor: { ...ctx.actor, role: "member" } }, d, NOW); check("receipt replay does not bypass read-only role", !readonly.ok && readonly.reason === "forbidden");

  // A writer whose preflight preceded the merge lands on the canonical file.
  const lateNote = randomUUID(), lateNeed = randomUUID(), lateActivity = randomUUID(), lateOpportunity = randomUUID(), lateParty = randomUUID();
  await db.insert(contactNotes).values({ id: lateNote, contactId: b, body: "Late preflight note", authorUserId: OWNER });
  await db.insert(contactNeeds).values({ id: lateNeed, contactId: b, kind: "rent" });
  await db.insert(contactActivities).values({ id: lateActivity, contactId: b, kind: "task", summary: "Late task" });
  await db.insert(contactOpportunities).values({ id: lateOpportunity, contactId: b, kind: "tenant" });
  await db.insert(transactionParties).values({ id: lateParty, contactId: b, transactionId: visibleDeal, role: "other", displayName: "Late party" });
  for (const [table, id] of [[contactNotes, lateNote], [contactNeeds, lateNeed], [contactActivities, lateActivity], [contactOpportunities, lateOpportunity], [transactionParties, lateParty]] as const) {
    const rows = await db.select().from(table).where(eq(table.id, id)); check("late child reference routes to canonical contact", rows[0].contactId === a);
  }

  const c = await make("Next primary"), second = input(await review(c, a), "duplicate");
  const chained = await mergeContacts(ctx, second, NOW); check("primary may be merged again with existing aliases", chained.ok);
  check("ancestor aliases flatten to the latest primary", (await getContact(ctx, b))?.id === c && (await db.select().from(contacts).where(eq(contacts.id, b)))[0].mergedIntoContactId === c);
  await db.update(contacts).set({ mergedIntoContactId: a }).where(eq(contacts.id, b));
  check("a read follows a newly merged intermediate target rather than returning a false 404", (await getContact(ctx, b))?.id === c);
  await db.update(contacts).set({ mergedIntoContactId: b }).where(eq(contacts.id, a));
  check("a corrupted alias cycle stops without revealing an unrelated record", await getContact(ctx, b) === null);
  await db.update(contacts).set({ mergedIntoContactId: c }).where(inArray(contacts.id, [a, b]));
  const chainHistory = await getTimelinePage(ctx, c, { pageSize: 100 }); check("historical audit facts from every merged source remain visible", chainHistory.ok && chainHistory.value.items.filter(item => item.title === "Client need added").length === 2);

  const x = await make("Stale primary"), y = await make("Stale source"), stale = input(await review(x, y));
  await addNote(ctx, y, { body: "New history after review" }, NOW);
  const refused = await mergeContacts(ctx, stale, NOW); check("new child history requires review without relying on parent revision", !refused.ok && refused.reason === "conflict");
  check("stale review has no partial moves/receipt", (await db.select().from(contactNotes).where(eq(contactNotes.contactId, y))).length === 1 && (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, stale.requestId))).length === 0);
  const late = input(await review(x, y));
  const baseBatch = db.batch.bind(db); let injected = false;
  db.batch = (async statements => { if (!injected) { injected = true; await db.insert(contactNotes).values({ contactId: y, authorUserId: OWNER, body: "History racing atomic merge" }); } return baseBatch(statements); }) as typeof db.batch;
  const race = await mergeContacts(ctx, late, NOW); db.batch = baseBatch;
  check("history added after preflight is refused by the atomic receipt guard", !race.ok && race.reason === "conflict");
  check("atomic refusal leaves both files and racing history intact", (await db.select().from(contactNotes).where(eq(contactNotes.contactId, y))).length === 2 && !(await db.select().from(contacts).where(eq(contacts.id, y)))[0].mergedIntoContactId);

  const other = await make("Other owner's contact", OTHER), adminCtx: Ctx = { ...ctx, actor: { ...ctx.actor, userId: ADMIN, role: "admin" } };
  const crossOwner = await getContactMergeReview(adminCtx, x, other); check("even an admin cannot merge different personal books", !crossOwner.ok && crossOwner.reason === "invalid_merge");
  check("outside brokerage review leaks no contacts", !(await getContactMergeReview({ ...ctx, actor: { ...ctx.actor, brokerageKey: "elsewhere" } }, x, y)).ok);
  const rollback = input(await review(x, y));
  await pg.exec(`create function reject_merge_test() returns trigger language plpgsql as $$ begin if new.safe_metadata->>'event'='contact_merged' then raise exception 'Synthetic audit failure'; end if; return new; end $$; create trigger reject_merge_test before insert on audit_events for each row execute function reject_merge_test();`);
  const failed = await mergeContacts(ctx, rollback, NOW);
  await pg.exec("drop trigger reject_merge_test on audit_events; drop function reject_merge_test()");
  check("audit failure aborts the merge", !failed.ok && failed.reason === "unavailable");
  check("audit failure rolls back every transfer and receipt", (await db.select().from(contactNotes).where(eq(contactNotes.contactId, y))).length === 2 && (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, rollback.requestId))).length === 0 && !(await db.select().from(contacts).where(eq(contacts.id, y)))[0].mergedIntoContactId);
  const left = input(await review(x, y)), right = input(await review(y, x));
  const parallel = await Promise.all([mergeContacts(ctx, left, NOW), mergeContacts(ctx, right, NOW)]);
  check("competing opposite merges commit only one winner", parallel.filter(result => result.ok).length === 1);
  const remaining = await db.select().from(contacts).where(inArray(contacts.id, [x, y]));
  check("competing merges never create a canonical cycle", remaining.filter(row => row.mergedIntoContactId === null).length === 1);
  const retryA = await make("Concurrent receipt primary"), retryB = await make("Concurrent receipt source"), retryInput = input(await review(retryA, retryB));
  const baseExecute = db.execute.bind(db); let winnerRan = false;
  db.execute = (async (...args: Parameters<typeof db.execute>) => {
    if (!winnerRan) { winnerRan = true; check("synthetic identical winner commits during the other caller's preflight", (await mergeContacts(ctx, retryInput, NOW)).ok); }
    return baseExecute(...args);
  }) as typeof db.execute;
  const concurrentRetry = await mergeContacts(ctx, retryInput, NOW); db.execute = baseExecute;
  check("identical retry recovers its receipt even when the winner commits before snapshot validation", concurrentRetry.ok && concurrentRetry.value.primary.id === retryA);
  check("preflight receipt recovery does not duplicate business history", (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, retryInput.requestId))).length === 1 && (await db.select().from(contactActivities).where(eq(contactActivities.contactId, retryA))).filter(row => row.safeMetadata?.event === "contact_merged").length === 1);
  const unicodeA = await make("Unicode primary"), unicodeB = await make("Unicode legacy source"), originalText = "a".repeat(9999) + "😀" + "suffix";
  await db.update(contacts).set({ notes: originalText }).where(eq(contacts.id, unicodeB));
  const unicodeInput = input(await review(unicodeA, unicodeB)); unicodeInput.choices.legacyNotes = "primary";
  check("long legacy Unicode text can be preserved as notes", (await mergeContacts(ctx, unicodeInput, NOW)).ok);
  const unicodeNotes = await listNotes(ctx, unicodeA);
  check("note chunks retain exact Unicode and original reading order", unicodeNotes.ok && unicodeNotes.value.map(note => note.body).join("") === originalText && unicodeNotes.value.every(note => note.body.length <= 10000));
  const propertyA = await make("Property list primary"), propertyB = await make("Property list source");
  const listA = randomUUID(), listB = randomUUID(), emptyListB = randomUUID(), privateListB = randomUUID(), personalList = randomUUID();
  await db.insert(propertyLists).values([
    { id: listA, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: propertyA, name: "Waterfront options", defaultForContactId: propertyA },
    { id: listB, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: propertyB, name: "Waterfront options", defaultForContactId: propertyB },
    { id: emptyListB, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: propertyB, name: "Unfilled research list" },
    { id: privateListB, ownerUserId: ADMIN, brokerageKey: "fortmark", contactId: propertyB, name: "Other owner's private research" },
    { id: personalList, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: null, name: "Personal research" },
  ]);
  const propertyIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const originalAdded = new Date("2026-08-01T12:00:00.000Z");
  await db.insert(contactProperties).values([
    { id: propertyIds[0], listId: listA, contactId: propertyA, dataset: "synthetic", listingId: "common-key", mlsNumber: "A12345678", createdByUserId: OWNER, createdAt: originalAdded, notes: "Private waterfront research", reviewStatus: "shortlisted" },
    { id: propertyIds[1], listId: listB, contactId: propertyB, dataset: "synthetic", listingId: "common-key", mlsNumber: "A12345678", createdByUserId: OWNER, notes: "Private alternative-list concern", reviewStatus: "ruled_out" },
    { id: propertyIds[2], listId: listB, contactId: propertyB, dataset: "synthetic", listingId: "unique-key", mlsNumber: "F12345678", createdByUserId: OWNER },
    { id: propertyIds[3], listId: listB, contactId: propertyB, dataset: "synthetic", listingId: "removed-key", mlsNumber: "RX-12345678", createdByUserId: OWNER, removedAt: originalAdded },
  ]);
  const privateProperty = randomUUID();
  await db.insert(contactProperties).values({ id: privateProperty, listId: privateListB, contactId: propertyB, dataset: "synthetic", listingId: "private-key", mlsNumber: "A88888888", createdByUserId: ADMIN });
  const propertyReview = await review(propertyA, propertyB);
  check("merge review retains separate-list memberships for the same property", propertyReview.primary.counts.properties === 1 && propertyReview.duplicate.counts.properties === 2 && propertyReview.preservedCounts.properties === 3);
  check("merge review includes owned empty lists but no other user's private list count", propertyReview.preservedCounts.propertyLists === 3);
  const adminPropertyReview = await review(propertyA, propertyB, adminCtx);
  check("an admin sees only their own research counts, even on visible contacts", adminPropertyReview.preservedCounts.properties === 1 && adminPropertyReview.preservedCounts.propertyLists === 1);
  const propertyMerge = await mergeContacts(ctx, input(propertyReview), NOW);
  check("contacts with a shared property merge successfully", propertyMerge.ok && propertyMerge.value.preservedCounts.properties === 3);
  const propertyRows = await db.select().from(contactProperties).where(inArray(contactProperties.id, propertyIds));
  check("all saved and removed property associations are retained by original ID", propertyRows.length === 4 && propertyRows.every(row => row.contactId === propertyA));
  check("same property in distinct lists remains saved in both lists", propertyRows.filter(row => !row.removedAt).length === 3 && propertyRows.find(row => row.id === propertyIds[0])?.listId === listA && propertyRows.find(row => row.id === propertyIds[1])?.listId === listB);
  check("merge preserves independent notes and review decisions for the same MLS property", propertyRows.find(row => row.id === propertyIds[0])?.notes === "Private waterfront research" && propertyRows.find(row => row.id === propertyIds[0])?.reviewStatus === "shortlisted" && propertyRows.find(row => row.id === propertyIds[1])?.notes === "Private alternative-list concern" && propertyRows.find(row => row.id === propertyIds[1])?.reviewStatus === "ruled_out");
  const mergedLists = await db.select().from(propertyLists).where(inArray(propertyLists.id, [listA, listB, emptyListB, privateListB]));
  check("merge retains all named and empty lists without changing owner or collapsing names", mergedLists.length === 4 && mergedLists.every(row => row.contactId === propertyA) && mergedLists.filter(row => row.name === "Waterfront options").length === 2 && mergedLists.find(row => row.id === privateListB)?.ownerUserId === ADMIN);
  check("default list anchors retain original identity through a merge", mergedLists.find(row => row.id === listA)?.defaultForContactId === propertyA && mergedLists.find(row => row.id === listB)?.defaultForContactId === propertyB);
  check("private membership is moved internally without adding it to the visible count", (await db.select().from(contactProperties).where(eq(contactProperties.id, privateProperty)))[0]?.contactId === propertyA);
  check("standalone research list remains unassociated with a contact", (await db.select().from(propertyLists).where(eq(propertyLists.id, personalList)))[0]?.contactId === null);
  check("merge retains original property save time and author", propertyRows.find(row => row.id === propertyIds[0])?.createdAt.toISOString() === originalAdded.toISOString() && propertyRows.every(row => row.createdByUserId === OWNER));
  check("previously removed property remains removed", propertyRows.find(row => row.id === propertyIds[3])?.removedAt?.toISOString() === originalAdded.toISOString());
  const lateProperty = randomUUID();
  await db.insert(contactProperties).values({ id: lateProperty, listId: listB, contactId: propertyB, dataset: "synthetic", listingId: "late-key", mlsNumber: "A87654321", createdByUserId: OWNER });
  check("late property association follows canonical contact", (await db.select().from(contactProperties).where(eq(contactProperties.id, lateProperty)))[0]?.contactId === propertyA);
  const lateList = randomUUID();
  await db.insert(propertyLists).values({ id: lateList, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: propertyB, name: "Late list creation" });
  check("late empty list follows the existing contact's canonical association", (await db.select().from(propertyLists).where(eq(propertyLists.id, lateList)))[0]?.contactId === propertyA);
  const propertyC = await make("Stale property list source"), propertyStale = input(await review(propertyA, propertyC));
  await db.update(contactProperties).set({ removedAt: NOW }).where(eq(contactProperties.id, lateProperty));
  const propertyRefused = await mergeContacts(ctx, propertyStale, NOW);
  check("saved-list change invalidates an opening merge review", !propertyRefused.ok && propertyRefused.reason === "conflict");
  const emptyStale = input(await review(propertyA, propertyC));
  await db.update(propertyLists).set({ name: "Changed empty research list" }).where(eq(propertyLists.id, emptyListB));
  const emptyRefused = await mergeContacts(ctx, emptyStale, NOW);
  check("renaming an empty list invalidates a merge review", !emptyRefused.ok && emptyRefused.reason === "conflict");
  const listC = randomUUID();
  await db.insert(propertyLists).values({ id: listC, ownerUserId: OWNER, brokerageKey: "fortmark", contactId: propertyC, name: "Racing research" });
  const propertyRace = input(await review(propertyA, propertyC)); let propertyInjected = false;
  db.batch = (async statements => { if (!propertyInjected) { propertyInjected = true; await db.insert(contactProperties).values({ listId: listC, contactId: propertyC, dataset: "synthetic", listingId: "racing-key", mlsNumber: "A99999999", createdByUserId: OWNER }); } return baseBatch(statements); }) as typeof db.batch;
  const propertyRaceResult = await mergeContacts(ctx, propertyRace, NOW); db.batch = baseBatch;
  check("property saved after preflight is protected by atomic merge guard", !propertyRaceResult.ok && propertyRaceResult.reason === "conflict");
  check("refused merge leaves racing saved property in its original file", (await db.select().from(contactProperties).where(eq(contactProperties.contactId, propertyC))).length === 1 && !(await db.select().from(contacts).where(eq(contacts.id, propertyC)))[0]?.mergedIntoContactId);
  const researchRace = input(await review(propertyA, propertyC)); let researchInjected = false;
  db.batch = (async statements => { if (!researchInjected) { researchInjected = true; await db.update(contactProperties).set({ notes: "Research updated while merging", reviewStatus: "to_review", updatedAt: new Date("2026-11-02T15:00:00.000Z") }).where(eq(contactProperties.id, propertyIds[0])); } return baseBatch(statements); }) as typeof db.batch;
  const researchRaceResult = await mergeContacts(ctx, researchRace, NOW); db.batch = baseBatch;
  check("research edited after merge preflight invalidates its atomic snapshot", !researchRaceResult.ok && researchRaceResult.reason === "conflict");
  check("refused merge retains the newer private note and review status", (await db.select().from(contactProperties).where(eq(contactProperties.id, propertyIds[0])))[0]?.notes === "Research updated while merging" && !(await db.select().from(contacts).where(eq(contacts.id, propertyC)))[0]?.mergedIntoContactId);

  const showingA = await make("Showing primary"), showingB = await make("Showing source");
  async function showing(contactId: string, values: Partial<typeof showings.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(showings).values({ id, ownerUserId: OWNER, brokerageKey: "fortmark", contactId,
      sourcePropertyId: propertyIds[0], dataset: "synthetic", listingId: "common-key", mlsNumber: "A12345678",
      startsAt: new Date("2026-11-05T15:00:00.000Z"), endsAt: new Date("2026-11-05T16:00:00.000Z"),
      meetingDetails: "Private showing meeting point", notes: "Private showing notes", createdAt: originalAdded, updatedAt: originalAdded,
      createRequestId: randomUUID(), createPayloadHash: "a".repeat(64), ...values });
    return id;
  }
  const primaryShowing = await showing(showingA);
  const completedShowing = await showing(showingB, { status: "completed", visitedAt: new Date("2026-11-05T15:30:00.000Z"),
    feedbackLikes: "Private showing likes", feedbackConcerns: "Private showing concerns", feedbackSummary: "Private showing summary" });
  const cancelledShowing = await showing(showingB, { status: "cancelled", cancelReason: "Private showing cancellation", sourcePropertyId: propertyIds[3], listingId: "removed-key", mlsNumber: "RX-12345678" });
  const privateShowing = await showing(showingB, { ownerUserId: ADMIN, notes: "Another owner's private showing" });
  const showingIds = [primaryShowing, completedShowing, cancelledShowing, privateShowing];
  const beforeShowingRows = await db.select().from(showings).where(inArray(showings.id, showingIds));
  const showingReview = await review(showingA, showingB);
  check("showing counts include only the caller's own appointments across all statuses", showingReview.primary.counts.showings === 1 && showingReview.duplicate.counts.showings === 2 && showingReview.preservedCounts.showings === 3);
  const adminShowingReview = await review(showingA, showingB, adminCtx);
  check("admin contact visibility does not expose another owner's private showing count", adminShowingReview.primary.counts.showings === 0 && adminShowingReview.duplicate.counts.showings === 1 && adminShowingReview.preservedCounts.showings === 1);
  check("merge review exposes no appointment details, notes or feedback", !/Private showing|Another owner's private/.test(JSON.stringify(showingReview)) && !/Private showing|Another owner's private/.test(JSON.stringify(adminShowingReview)));
  const showingMergeInput = input(showingReview), showingMerged = await mergeContacts(ctx, showingMergeInput, NOW);
  check("reviewed contact merge reports its visible retained showing count", showingMerged.ok && showingMerged.value.preservedCounts.showings === 3);
  const afterShowingRows = await db.select().from(showings).where(inArray(showings.id, showingIds));
  check("all showing identities, including another owner's private appointment, move to the primary", afterShowingRows.length === showingIds.length && afterShowingRows.every(row => row.contactId === showingA));
  const showingContent = ({ contactId: _contact, updatedAt: _revision, ...rest }: ShowingRow) => JSON.stringify(rest);
  check("merge preserves every original appointment field, feedback and creation receipt", afterShowingRows.every(row => showingContent(row) === showingContent(beforeShowingRows.find(original => original.id === row.id)!)));
  check("reparented appointments advance revision while unchanged primary appointments keep theirs", afterShowingRows.every(row => row.id === primaryShowing ? row.updatedAt.getTime() === originalAdded.getTime() : row.updatedAt.getTime() > originalAdded.getTime()));
  check("removed source-property reference remains intact on historical showing", afterShowingRows.find(row => row.id === cancelledShowing)?.sourcePropertyId === propertyIds[3]);
  const showingReceipt = (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, showingMergeInput.requestId)))[0];
  check("merge receipt includes safe visible showing count without appointment content", showingReceipt.result.preservedCounts && (showingReceipt.result.preservedCounts as { showings: number }).showings === 3 && !/Private showing|Another owner's private/.test(JSON.stringify(showingReceipt.result)));
  check("showing merge retry returns the original safe receipt", (await mergeContacts(ctx, showingMergeInput, NOW)).ok);
  check("showing merge retry does not duplicate or rewrite appointments", (await db.select().from(showings).where(inArray(showings.id, showingIds))).every(row => JSON.stringify(row) === JSON.stringify(afterShowingRows.find(original => original.id === row.id))));
  const lateShowing = await showing(showingB);
  check("a late showing using the old contact ID routes to the canonical contact", (await db.select().from(showings).where(eq(showings.id, lateShowing)))[0]?.contactId === showingA);

  const showingC = await make("Stale showing source");
  let mutableShowing = "";
  for (const change of ["created", "edited", "feedback", "cancelled"] as const) {
    const opening = input(await review(showingA, showingC));
    if (change === "created") mutableShowing = await showing(showingC);
    else if (change === "edited") await db.update(showings).set({ meetingDetails: "Changed showing meeting point" }).where(eq(showings.id, mutableShowing));
    else if (change === "feedback") await db.update(showings).set({ status: "completed", visitedAt: new Date("2026-11-05T15:30:00.000Z"), feedbackSummary: "Newest private showing feedback" }).where(eq(showings.id, mutableShowing));
    else await db.update(showings).set({ status: "cancelled", visitedAt: null, cancelReason: "New private cancellation" }).where(eq(showings.id, mutableShowing));
    const result = await mergeContacts(ctx, opening, NOW);
    check(`showing ${change} invalidates a review even without a parent or showing revision bump`, !result.ok && result.reason === "conflict");
    check(`stale ${change} review leaves showing and merge receipt untouched`, (await db.select().from(showings).where(eq(showings.id, mutableShowing)))[0]?.contactId === showingC && (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, opening.requestId))).length === 0);
  }
  const showingRace = input(await review(showingA, showingC)); let showingInjected = false;
  db.batch = (async statements => {
    if (!showingInjected) { showingInjected = true; await db.update(showings).set({ feedbackConcerns: "Feedback changed after merge preflight" }).where(eq(showings.id, mutableShowing)); }
    return baseBatch(statements);
  }) as typeof db.batch;
  const showingRaceResult = await mergeContacts(ctx, showingRace, NOW); db.batch = baseBatch;
  check("showing feedback changed after preflight is rejected by the atomic receipt guard", !showingRaceResult.ok && showingRaceResult.reason === "conflict");
  check("atomic showing refusal retains the latest feedback on its original contact", (await db.select().from(showings).where(eq(showings.id, mutableShowing)))[0]?.feedbackConcerns === "Feedback changed after merge preflight" && !(await db.select().from(contacts).where(eq(contacts.id, showingC)))[0]?.mergedIntoContactId);
  const showingRollback = input(await review(showingA, showingC));
  const beforeShowingRollback = (await db.select().from(showings).where(eq(showings.id, mutableShowing)))[0];
  await pg.exec("create function reject_showing_merge_test() returns trigger language plpgsql as $$begin if new.safe_metadata->>'event'='contact_merged' then raise exception 'Synthetic showing merge audit failure'; end if; return new; end$$; create trigger reject_showing_merge_test before insert on audit_events for each row execute function reject_showing_merge_test()");
  const showingRollbackResult = await mergeContacts(ctx, showingRollback, NOW);
  await pg.exec("drop trigger reject_showing_merge_test on audit_events; drop function reject_showing_merge_test()");
  check("failed merge audit rolls back showing reparent and revision together", !showingRollbackResult.ok && showingRollbackResult.reason === "unavailable" && JSON.stringify((await db.select().from(showings).where(eq(showings.id, mutableShowing)))[0]) === JSON.stringify(beforeShowingRollback));
  check("failed showing transfer leaves no merge receipt or archived alias", (await db.select().from(contactMergeRequests).where(eq(contactMergeRequests.requestId, showingRollback.requestId))).length === 0 && !(await db.select().from(contacts).where(eq(contacts.id, showingC)))[0]?.mergedIntoContactId);

  const tourA = await make("Tour primary"), tourB = await make("Tour duplicate"), tourC = await make("Tour racing source");
  async function savedTour(contactId: string, ownerUserId = OWNER) {
    const listId = randomUUID(), id = randomUUID(), propertyIds = [randomUUID(), randomUUID()];
    await db.insert(propertyLists).values({ id: listId, ownerUserId, brokerageKey: "fortmark", contactId, name: "Private tour source" });
    await db.insert(contactProperties).values(propertyIds.map((id, index) => ({ id, listId, contactId, dataset: "synthetic", listingId: `tour-source-${id}`, mlsNumber: `A1234567${index}`, createdByUserId: ownerUserId })));
    await db.insert(savedShowingTours).values({ id, ownerUserId, brokerageKey: "fortmark", contactId, sourceListId: listId, name: "Private saved tour", notes: "Private tour notes", originAddress: "Private office address", startsAt: new Date("2026-11-07T14:00:00Z"), createdAt: originalAdded, updatedAt: originalAdded, createRequestId: randomUUID(), createPayloadHash: "b".repeat(64) });
    await db.insert(savedTourStops).values(propertyIds.map((propertyId, position) => ({ tourId: id, propertyId, position, visitMinutes: 30 })));
    return id;
  }
  const primaryTour = await savedTour(tourA), duplicateTour = await savedTour(tourB), hiddenTour = await savedTour(tourB, ADMIN);
  const beforeTours = await db.select().from(savedShowingTours).where(inArray(savedShowingTours.id, [primaryTour, duplicateTour, hiddenTour]));
  const beforeTourStops = await db.select().from(savedTourStops).where(inArray(savedTourStops.tourId, [primaryTour, duplicateTour, hiddenTour]));
  const tourReview = await review(tourA, tourB), adminTourReview = await review(tourA, tourB, adminCtx);
  check("merge counts only the caller's saved tours even for an administrator", tourReview.preservedCounts.savedTours === 2 && adminTourReview.preservedCounts.savedTours === 1);
  check("merge review hides tour names, notes, private endpoints and signing material", !/Private saved tour|Private tour notes|Private office address|reviewKey/.test(JSON.stringify(tourReview)));
  const tourInput = input(tourReview), tourMerged = await mergeContacts(ctx, tourInput, NOW);
  check("saved tours survive a reviewed contact merge", tourMerged.ok && tourMerged.value.preservedCounts.savedTours === 2);
  const afterTours = await db.select().from(savedShowingTours).where(inArray(savedShowingTours.id, [primaryTour, duplicateTour, hiddenTour]));
  const tourContent = (row: typeof savedShowingTours.$inferSelect) => { const { contactId: _contact, updatedAt: _rev, ...rest } = row; return JSON.stringify(rest); };
  check("all owned and hidden tours retain content, ownership, source IDs and receipt anchors", afterTours.length === 3 && afterTours.every(row => row.contactId === tourA && tourContent(row) === tourContent(beforeTours.find(before => before.id === row.id)!)));
  check("reparented tours advance revision while the keeper tour keeps its revision", afterTours.every(row => row.id === primaryTour ? row.updatedAt.getTime() === originalAdded.getTime() : row.updatedAt.getTime() > originalAdded.getTime()));
  const afterTourStops = await db.select().from(savedTourStops).where(inArray(savedTourStops.tourId, [primaryTour, duplicateTour, hiddenTour]));
  check("merge preserves exact saved stop rows and order", JSON.stringify(beforeTourStops) === JSON.stringify(afterTourStops));
  check("tour merge replay returns original receipt without rewriting tours", (await mergeContacts(ctx, tourInput, NOW)).ok && JSON.stringify(afterTours) === JSON.stringify(await db.select().from(savedShowingTours).where(inArray(savedShowingTours.id, [primaryTour, duplicateTour, hiddenTour]))));
  const lateTour = await savedTour(tourB);
  check("a saved tour written using a merged contact alias routes to the keeper", (await db.select().from(savedShowingTours).where(eq(savedShowingTours.id, lateTour)))[0]?.contactId === tourA);
  const racingTour = await savedTour(tourC);
  const stopRace = input(await review(tourA, tourC)); let stopInjected = false;
  db.batch = (async statements => { if (!stopInjected) { stopInjected = true; await db.update(savedTourStops).set({ visitMinutes: 45 }).where(eq(savedTourStops.tourId, racingTour)); } return baseBatch(statements); }) as typeof db.batch;
  const stopRaceResult = await mergeContacts(ctx, stopRace, NOW); db.batch = baseBatch;
  check("a stop changed after preflight invalidates the atomic merge even without a revision bump", !stopRaceResult.ok && stopRaceResult.reason === "conflict");
  const privateTourRace = input(await review(tourA, tourC));
  await db.update(savedShowingTours).set({ notes: "New private research" }).where(eq(savedShowingTours.id, hiddenTour));
  const privateTourRefused = await mergeContacts(ctx, privateTourRace, NOW);
  check("hidden private tour edits invalidate a merge without revealing their content", !privateTourRefused.ok && privateTourRefused.reason === "conflict");
  const tourRollbackInput = input(await review(tourA, tourC));
  const beforeTourRollback = (await db.select().from(savedShowingTours).where(eq(savedShowingTours.id, racingTour)))[0];
  await pg.exec("create function reject_tour_merge_test() returns trigger language plpgsql as $$begin if new.safe_metadata->>'event'='contact_merged' then raise exception 'Synthetic tour merge failure'; end if; return new; end$$; create trigger reject_tour_merge_test before insert on audit_events for each row execute function reject_tour_merge_test()");
  const tourRollback = await mergeContacts(ctx, tourRollbackInput, NOW);
  await pg.exec("drop trigger reject_tour_merge_test on audit_events; drop function reject_tour_merge_test()");
  check("audit failure rolls back tour association and revision together", !tourRollback.ok && tourRollback.reason === "unavailable" && JSON.stringify(beforeTourRollback) === JSON.stringify((await db.select().from(savedShowingTours).where(eq(savedShowingTours.id, racingTour)))[0]));
  console.log(`\n${passed}/${passed} contact merge checks passed (ephemeral PostgreSQL; no live access)`);
} finally { await pg.close(); }
