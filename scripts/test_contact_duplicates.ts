/** Duplicate hints and exact import sets against isolated PostgreSQL; no live access. */
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { contacts, dashboardUsers } from "../lib/db/schema.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import {
  normalizeDuplicateEmail, normalizeDuplicatePhone, normalizeDuplicateName, duplicateReasons, duplicatePair,
  duplicateSuggestionsFromContacts, encodeDuplicateCursor, decodeDuplicateCursor, readDuplicateQuery,
  COMPLETED_DUPLICATE_ANCHOR,
  type DuplicateRecord,
} from "../lib/contacts/duplicates.ts";
import { findExactContactDuplicates, findImportContactDuplicates, getContactDuplicateSuggestions, exactDuplicatePredicate, ownDuplicateBookPredicate } from "../lib/contacts/duplicates-service.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
check("email comparison trims and folds case", normalizeDuplicateEmail(" Person@Example.Test ") === "person@example.test");
check("email aliases are not guessed", normalizeDuplicateEmail("person+one@example.test") !== normalizeDuplicateEmail("person@example.test") && normalizeDuplicateEmail("p.erson@example.test") !== normalizeDuplicateEmail("person@example.test"));
for (const input of [undefined, null, "", " ", "broken", "a@@example.test", "a@example.test extra", "a\u0000@example.test", "x".repeat(321)]) check("unusable email has no match key", normalizeDuplicateEmail(input) === null);
check("US phone formats normalize to E164", ["9545550100", "(954) 555-0100", "+1 (954) 555-0100"].every(phone => normalizeDuplicatePhone(phone) === "+19545550100"));
check("international E164 remains international", normalizeDuplicatePhone("+44 20 7946 0958") === "+442079460958");
for (const phone of ["", " ", "123", "x".repeat(41)]) check("missing or unusable phone never matches", normalizeDuplicatePhone(phone) === null);
check("name punctuation, case and accents normalize", normalizeDuplicateName("  JOSÉ O’Neal  ") === "jose o neal");
check("name hint is advisory, not an exact identity", duplicateReasons({ firstName: "José", lastName: "Rivera" }, { firstName: "Jose", lastName: "Rivera" }).join() === "similar_name");
check("similar full names are advisory", duplicateReasons({ firstName: "Alicia", lastName: "Grant" }, { firstName: "Alice", lastName: "Grant" }).includes("similar_name"));
check("a first name alone is insufficient", duplicateReasons({ firstName: "Jordan" }, { firstName: "Jordan" }).length === 0);
check("numeric fixture names are not name hints", duplicateReasons({ name: "Sample Contact01" }, { name: "Sample Contact02" }).length === 0);
check("missing identifiers do not match", duplicateReasons({}, {}).length === 0);
const fixture: DuplicateRecord = { id: uid(1), firstName: "A", lastName: "One", email: "a@example.test", stage: "lead", updatedAt: "2026-10-30T12:00:00.000Z" };
check("pair direction is stable independent of caller order", duplicatePair({ ...fixture, id: uid(2) }, fixture)?.primary.id === uid(1));
check("a row cannot duplicate itself", duplicatePair(fixture, fixture) === null);
const token = encodeDuplicateCursor({ primaryId: uid(1), duplicateId: uid(2) });
check("cursor roundtrip contains pair IDs only", JSON.stringify(decodeDuplicateCursor(token)) === JSON.stringify({ primaryId: uid(1), duplicateId: uid(2) }));
for (const input of ["", "no!", "a".repeat(181), encodeDuplicateCursor({ primaryId: uid(2), duplicateId: uid(1) }), btoa(JSON.stringify({ v: 1, primaryId: uid(1), duplicateId: uid(2), email: "private@example.test" }))]) check("invalid or content-bearing cursor is rejected", decodeDuplicateCursor(input) === null);
for (const query of ["pageSize=0", "pageSize=51", "pageSize=-1", "pageSize=NaN", "cursor="]) check("invalid duplicate paging query is rejected", readDuplicateQuery(new URLSearchParams(query)) === null);

const { pg, db } = await createLocalContactDb();
const actor = { userId: uid(9001), role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: uid(9002) };
const admin = { ...actor, userId: uid(9003), role: "admin" as const };
const ctx: Ctx = { actor, db };
const now = new Date("2026-10-30T12:00:00.000Z");
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_duplicate_${index}`, primaryEmail: `synthetic${index}@example.test`, status: "active" as const })));
  const own = Array.from({ length: 145 }, (_, index) => ({
    id: uid(index + 1), assignedAgentUserId: actor.userId, firstName: "Synthetic", lastName: `Person${index + 1}`,
    email: index < 16 ? "shared@example.test" : `unique${index}@example.test`, stage: "lead" as const, updatedAt: now,
  }));
  await db.insert(contacts).values(own);
  await db.insert(contacts).values([
    { id: uid(201), assignedAgentUserId: actor.userId, firstName: "Phone", lastName: "Person1", phoneE164: "+19545550100", updatedAt: now },
    { id: uid(202), assignedAgentUserId: actor.userId, firstName: "Phone", lastName: "Person2", phoneE164: "(954) 555-0100", updatedAt: now },
    { id: uid(203), assignedAgentUserId: actor.userId, firstName: "José", lastName: "Rivera", updatedAt: now },
    { id: uid(204), assignedAgentUserId: actor.userId, firstName: "Jose", lastName: "Rivera", updatedAt: now },
    { id: uid(205), assignedAgentUserId: actor.userId, firstName: "Alicia", lastName: "Grant", updatedAt: now },
    { id: uid(206), assignedAgentUserId: actor.userId, firstName: "Alice", lastName: "Grant", updatedAt: now },
    { id: uid(207), assignedAgentUserId: actor.userId, firstName: "李", lastName: "王", updatedAt: now },
    { id: uid(208), assignedAgentUserId: actor.userId, firstName: "李", lastName: "王", updatedAt: now },
    { id: uid(209), assignedAgentUserId: actor.userId, firstName: "Invalid", lastName: "Identifier1", email: "not-email", phoneE164: "123", updatedAt: now },
    { id: uid(210), assignedAgentUserId: actor.userId, firstName: "Invalid", lastName: "Identifier2", email: "not-email", phoneE164: "123", updatedAt: now },
    { id: uid(301), assignedAgentUserId: other.userId, firstName: "Other", lastName: "Owner", email: "shared@example.test", updatedAt: now },
    { id: uid(302), assignedAgentUserId: actor.userId, brokerageKey: "another", firstName: "Other", lastName: "Brokerage", email: "shared@example.test", updatedAt: now },
    { id: uid(303), assignedAgentUserId: admin.userId, firstName: "Admin", lastName: "Person1", email: "shared@example.test", updatedAt: now },
    { id: uid(304), assignedAgentUserId: admin.userId, firstName: "Admin", lastName: "Person2", email: "shared@example.test", updatedAt: now },
  ]);
  // Alias identity resolves to its chosen canonical, but never appears in pair review.
  await db.insert(contacts).values({ id: uid(401), assignedAgentUserId: actor.userId, firstName: "Merged", lastName: "Alias1", email: "old-address@example.test", phoneE164: "+19545550401", stage: "archived", mergedIntoContactId: uid(20), mergedAt: now, updatedAt: now });

  const exact = await findExactContactDuplicates(ctx, { email: " SHARED@EXAMPLE.TEST " });
  check("exact matcher returns complete own-book set", exact.ok && exact.value.count === 16 && exact.value.matches.length === 16 && exact.value.sources.length === 16);
  check("exact results omit another owner and another brokerage", exact.ok && exact.value.matches.every(match => Number(match.contact.id.slice(-12)) <= 16));
  const phone = await findExactContactDuplicates(ctx, { phone: "9545550100" });
  check("SQL phone normalizer agrees with raw and E164 pure matcher", phone.ok && phone.value.count === 2 && phone.value.matches.every(match => match.reasons.includes("exact_phone")));
  const alias = await findExactContactDuplicates(ctx, { email: "old-address@example.test" });
  check("old alias identity resolves to canonical only", alias.ok && alias.value.count === 1 && alias.value.matches[0].contact.id === uid(20) && alias.value.sources[0].id === uid(401));
  check("old alias phone also resolves", (await findExactContactDuplicates(ctx, { phone: "+19545550401" })).ok && (await findExactContactDuplicates(ctx, { phone: "+19545550401" }) as { ok: true; value: { matches: { contact: { id: string } }[] } }).value.matches[0].contact.id === uid(20));
  const aliasAgain = await findExactContactDuplicates(ctx, { email: "old-address@example.test" });
  check("unchanged complete exact set has stable fingerprint", aliasAgain.ok && alias.ok && aliasAgain.value.fingerprint === alias.value.fingerprint);
  await db.update(contacts).set({ updatedAt: new Date(now.getTime() + 1000) }).where(eq(contacts.id, uid(401)));
  const changedAlias = await findExactContactDuplicates(ctx, { email: "old-address@example.test" });
  check("alias revision invalidates fingerprint", changedAlias.ok && alias.ok && changedAlias.value.fingerprint !== alias.value.fingerprint);
  await db.update(contacts).set({ updatedAt: new Date(now.getTime() + 2000) }).where(eq(contacts.id, uid(20)));
  const changedCanonical = await findExactContactDuplicates(ctx, { email: "old-address@example.test" });
  check("canonical revision invalidates alias-resolved fingerprint", changedCanonical.ok && changedAlias.ok && changedCanonical.value.fingerprint !== changedAlias.value.fingerprint);
  await db.insert(contacts).values({ id: uid(402), assignedAgentUserId: actor.userId, firstName: "Merged", lastName: "Alias2", email: "old-address@example.test", stage: "archived", mergedIntoContactId: uid(20), mergedAt: now, updatedAt: now });
  const twoAliases = await findExactContactDuplicates(ctx, { email: "old-address@example.test" });
  check("several matching aliases dedupe to one canonical candidate", twoAliases.ok && twoAliases.value.count === 1 && twoAliases.value.sources.length === 2);
  check("adding an exact source changes complete-set fingerprint", twoAliases.ok && changedCanonical.ok && twoAliases.value.fingerprint !== changedCanonical.value.fingerprint);
  const excluded = await findExactContactDuplicates(ctx, { email: "shared@example.test" }, { excludeContactId: uid(1) });
  check("self exclusion removes candidate and its sources", excluded.ok && excluded.value.count === 15 && !excluded.value.sources.some(source => source.canonicalId === uid(1)));
  const adminResult = await findExactContactDuplicates({ actor: admin, db }, { email: "shared@example.test" });
  check("admin exact lookup remains personal-book only", adminResult.ok && adminResult.value.count === 2 && adminResult.value.matches.every(match => [uid(303), uid(304)].includes(match.contact.id)));
  check("members cannot scan duplicates", !(await getContactDuplicateSuggestions({ actor: { ...actor, role: "member" }, db })).ok);
  check("members cannot obtain import exact sets", !(await findExactContactDuplicates({ actor: { ...actor, role: "member" }, db }, { email: "shared@example.test" })).ok);

  const rows = await db.select().from(contacts).where(sql`${ownDuplicateBookPredicate(actor)}`);
  const pure = duplicateSuggestionsFromContacts(rows, { pageSize: 50 });
  const ids: string[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await getContactDuplicateSuggestions(ctx, { pageSize: 50, cursor });
    check("SQL duplicate page succeeds", page.ok);
    check("pair page is bounded", page.value.pairs.length <= 50);
    check("whole own-book count is honest", page.value.totalContacts === 155);
    check("scan counts are bounded and monotonic", page.value.scannedContacts >= scanned && page.value.scannedContacts <= page.value.totalContacts);
    scanned = page.value.scannedContacts;
    check("cursor continuation agrees with hasMore", page.value.hasMore === Boolean(page.value.nextCursor));
    check("merged aliases never appear in duplicate pairs", page.value.pairs.every(pair => pair.primary.id !== uid(401) && pair.duplicate.id !== uid(401)));
    check("private client context does not leak into pair DTOs", page.value.pairs.every(pair => Object.keys(pair.primary).every(key => ["id", "name", "email", "phone", "company", "stage", "updatedAt"].includes(key))));
    ids.push(...page.value.pairs.map(pair => `${pair.primary.id}:${pair.duplicate.id}:${pair.reasons.join()}`));
    if (!cursor) check("SQL pair order/reasons match shared pure implementation", JSON.stringify(page.value) === JSON.stringify(pure));
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor);
  const expected: string[] = [];
  let pureCursor;
  do {
    const page = duplicateSuggestionsFromContacts(rows, { pageSize: 50, cursor: pureCursor });
    expected.push(...page.pairs.map(pair => `${pair.primary.id}:${pair.duplicate.id}:${pair.reasons.join()}`));
    pureCursor = page.nextCursor ? decodeDuplicateCursor(page.nextCursor)! : undefined;
  } while (pureCursor);
  check("all pair pages are complete and duplicate-free", ids.join() === expected.join() && new Set(ids).size === ids.length && ids.length === 124);
  check("a completed scan reports all eligible contacts examined", scanned === 155);
  const adminPage = await getContactDuplicateSuggestions({ actor: admin, db });
  check("admin pair review includes only own pair", adminPage.ok && adminPage.value.totalContacts === 2 && adminPage.value.pairs.length === 1);
  for (const options of [{ pageSize: 0 }, { pageSize: 51 }, { pageSize: 1.5 }, { cursor: "" }, { cursor: "bad" }]) check("service validates paging independently", !(await getContactDuplicateSuggestions(ctx, options)).ok);

  const advisory = await findImportContactDuplicates(ctx, { firstName: "Jose", lastName: "Rivera", email: "new@example.test" });
  check("name-only import hints do not become exact blockers", advisory.ok && advisory.value.count === 0 && advisory.value.matches.length === 2 && advisory.value.matches.every(match => match.reasons.join() === "similar_name"));
  const noIdentifiers = await findExactContactDuplicates(ctx, {});
  check("name advisory does not alter exact fingerprint", noIdentifiers.ok && advisory.ok && advisory.value.fingerprint === noIdentifiers.value.fingerprint);
  const sharedPredicate = exactDuplicatePredicate({ email: "old-address@example.test" });
  const sourceRows = await db.select({ id: contacts.id }).from(contacts).where(sql`${ownDuplicateBookPredicate(actor, contacts, { includeMerged: true })} and ${sharedPredicate}`);
  check("atomic import guard predicate sees every alias source", sourceRows.length === 2 && sourceRows.some(source => source.id === uid(401)) && sourceRows.some(source => source.id === uid(402)));
  await db.insert(contacts).values({ id: uid(403), assignedAgentUserId: actor.userId, firstName: "Old", lastName: "Alias3", email: "jose-old@example.test", stage: "archived", mergedIntoContactId: uid(203), mergedAt: now, updatedAt: now });
  const mixedHints = await findImportContactDuplicates(ctx, { firstName: "Jose", lastName: "Rivera", email: "jose-old@example.test" });
  check("canonical exact candidate is never repeated as name advisory", mixedHints.ok && mixedHints.value.count === 1 && mixedHints.value.matches.length === 2 && new Set(mixedHints.value.matches.map(match => match.contact.id)).size === 2);
  await db.insert(contacts).values(Array.from({ length: 12 }, (_, index) => ({ id: uid(501 + index), assignedAgentUserId: actor.userId, firstName: "Advisory", lastName: "Only", updatedAt: now })));
  const boundedHints = await findImportContactDuplicates(ctx, { firstName: "Advisory", lastName: "Only" });
  check("advisory limit never pretends to be a complete exact count", boundedHints.ok && boundedHints.value.count === 0 && boundedHints.value.matches.length === 10 && boundedHints.value.advisoryHasMore);

  // Exact lookup never reuses the bounded pair/advisory limits.
  await db.insert(contacts).values(Array.from({ length: 121 }, (_, index) => ({ id: uid(1001 + index), assignedAgentUserId: other.userId, firstName: "Bulk", lastName: `Exact${index}`, email: "bulk-exact@example.test", updatedAt: now })));
  const completeExact = await findExactContactDuplicates({ actor: other, db }, { email: "bulk-exact@example.test" });
  check("exact helper returns all121 matches beyond former100-style caps", completeExact.ok && completeExact.value.count === 121 && completeExact.value.matches.length === 121 && completeExact.value.sources.length === 121);
  const anchorTargets: string[] = [];
  let heavyCursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const result = await getContactDuplicateSuggestions({ actor: other, db }, { pageSize: 50, cursor: heavyCursor });
    check("large anchor page succeeds with bounded output", result.ok && result.value.pairs.length === 50 && result.value.hasMore);
    anchorTargets.push(...result.value.pairs.filter(pair => pair.primary.id === uid(1001)).map(pair => pair.duplicate.id));
    heavyCursor = result.value.nextCursor ?? undefined;
  }
  check("one anchor's120 matches survive several pair cursors without skips", anchorTargets.length === 120 && new Set(anchorTargets).size === 120 && anchorTargets[0] === uid(1002) && anchorTargets[119] === uid(1121));

  const emptyOwner = { ...actor, userId: uid(9004) };
  await db.insert(dashboardUsers).values({ id: emptyOwner.userId, role: "agent", clerkUserId: "synthetic_empty_duplicate_scan", primaryEmail: "empty@example.test", status: "active" });
  await db.insert(contacts).values(Array.from({ length: 245 }, (_, index) => ({ id: uid(2001 + index), assignedAgentUserId: emptyOwner.userId, firstName: "Unique", lastName: `Scan${index}`, email: `empty-scan${index}@example.test`, updatedAt: now })));
  let emptyCursor: string | undefined;
  for (const expectedScanned of [100, 200, 245]) {
    const result = await getContactDuplicateSuggestions({ actor: emptyOwner, db }, { cursor: emptyCursor });
    check("empty intermediate page keeps truthful bounded scan progress", result.ok && result.value.pairs.length === 0 && result.value.totalContacts === 245 && result.value.scannedContacts === expectedScanned && result.value.hasMore === (expectedScanned < 245));
    check("empty-page cursor is opaque completed anchor IDs only", result.ok && (result.value.nextCursor ? decodeDuplicateCursor(result.value.nextCursor)?.duplicateId === COMPLETED_DUPLICATE_ANCHOR : expectedScanned === 245));
    emptyCursor = result.value.nextCursor ?? undefined;
  }
  console.log(`${passed}/${passed} contact duplicate checks passed (isolated PostgreSQL; no live access)`);
} finally { await pg.close(); }
