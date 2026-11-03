/** Bounded CSV parsing and actual PostgreSQL import/retry/rollback checks. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/client.ts";
import { auditEvents, contactActivities, contactEngagementFiles, contactImportRequests, contactNotes, contacts, dashboardUsers } from "../lib/db/schema.ts";
import { IMPORT_LIMITS, mapImportRows, normalizeImportRow, parseContactCsv, suggestImportMapping, type ImportRawRow, type ImportPreview, type ImportCommitInput } from "../lib/contacts/import.ts";
import { commitContactImport, previewContactImport } from "../lib/contacts/import-service.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";

let checks = 0;
function check(name: string, condition: unknown) { assert.ok(condition, name); checks++; }
const now = new Date("2026-10-29T16:00:00.000Z");
const owner = { userId: "11111111-1111-4111-8111-111111111111", brokerageKey: "fortmark", role: "agent" as const };
const other = { ...owner, userId: "22222222-2222-4222-8222-222222222222" };
const admin = { ...owner, userId: "33333333-3333-4333-8333-333333333333", role: "admin" as const };
const raw = (values: ImportRawRow["values"], rowNumber = 2): ImportRawRow => ({ rowNumber, values });
const { pg, db } = await createLocalContactDb();
const ctx: Ctx = { actor: owner, db };
const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
async function reset() { await pg.exec("truncate contacts,audit_events,contact_import_requests,contact_merge_requests cascade"); }
async function seed(values: Partial<typeof contacts.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(contacts).values({ id, firstName: "Existing", lastName: "Contact", assignedAgentUserId: owner.userId, brokerageKey: owner.brokerageKey, createdAt: now, updatedAt: now, ...values });
  return id;
}
async function preview(rows: ImportRawRow[], context = ctx): Promise<ImportPreview> { const result = await previewContactImport(context, { rows }); assert.ok(result.ok); return result.value; }
function commitInput(p: ImportPreview, decisions: Partial<ImportCommitInput["rows"][number]>[] = []): ImportCommitInput {
  return { requestId: randomUUID(), rows: p.rows.map((row, index) => ({ rowNumber: row.rowNumber, values: row.values, reviewFingerprint: row.reviewFingerprint, decision: row.recommendedDecision, ...decisions[index] })) };
}
function beforeBatch(work: () => Promise<void>, after = false): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) {
    if (property === "batch") return async (writes: Parameters<Db["batch"]>[0]) => {
      if (pending && !after) { pending = false; await work(); }
      const result = await target.batch(writes);
      if (pending && after) { pending = false; await work(); }
      return result;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function failOn(table: string) {
  await pg.exec(`create function fail_import_write() returns trigger language plpgsql as $$begin raise exception 'local import failure'; end$$;
    create trigger import_failure before insert on ${table} for each row execute function fail_import_write()`);
  return async () => { await pg.exec(`drop trigger import_failure on ${table}; drop function fail_import_write()`); };
}
try {
  for (const delimiter of [",", ";", "\t"] as const) {
    const text = `\uFEFFFull Name${delimiter}Email${delimiter}Notes\r\n"Synthetic, Person"${delimiter}PERSON@EXAMPLE.TEST${delimiter}"First line\r\nSecond ""quoted"" line"\r\n`;
    const parsed = parseContactCsv(text);
    check("BOM/CRLF/delimiter and quoted multiline parse without losing text", parsed.ok && parsed.delimiter === delimiter && parsed.rows.length === 1 && parsed.rows[0].cells[2] === 'First line\r\nSecond "quoted" line');
    if (parsed.ok) {
      const rows = mapImportRows(parsed, suggestImportMapping(parsed.headers));
      const normalized = normalizeImportRow(rows[0]);
      check("mapping preserves the full name and normalizes email only", !normalized.errors.length && normalized.values.preferredName === "Synthetic, Person" && normalized.values.email === "person@example.test");
    }
  }
  for (const bad of ['Name,Email\n"Unclosed,x', 'Name,Email\nBad"quote,x', 'Name,Email\n"Closed"junk,x', 'Name,Email\nOnly one', "Name\nBad\0text"]) check("malformed quotes/width/NUL are refused", !parseContactCsv(bad).ok);
  check("formula-like cells stay literal text and are never evaluated", (() => { const p = parseContactCsv('Name\n"=1+1"'); return p.ok && p.rows[0].cells[0] === "=1+1"; })());
  check("row, byte, column and cell limits are enforced", !parseContactCsv("Name\n" + Array.from({ length: 251 }, () => "Person").join("\n")).ok && !parseContactCsv("x".repeat(IMPORT_LIMITS.bytes + 1)).ok && !parseContactCsv(Array.from({ length: 51 }, (_, i) => `H${i}`).join(",") + "\n" + Array(51).fill("x").join(",")).ok && !parseContactCsv("Name\n" + "x".repeat(10001)).ok);
  check("exact row, column and cell boundaries remain usable", parseContactCsv("Name\n" + Array.from({ length: 250 }, () => "Person").join("\n")).ok && parseContactCsv(Array.from({ length: 50 }, (_, i) => `H${i}`).join(",") + "\n" + Array(50).fill("x").join(",")).ok && parseContactCsv("Notes\n" + "x".repeat(10000)).ok);
  check("quoted final cells need no trailing newline", (() => { const p = parseContactCsv('Name,Notes\n"Person","No newline"'); return p.ok && p.rows[0].cells[1] === "No newline"; })());
  const normalized = normalizeImportRow(raw({ firstName: " New ", email: " EMAIL@EXAMPLE.TEST ", phone: "(954) 555-0123", source: "Open house", stage: "Active client", company: " ", about: " private ", notes: "append" }));
  check("stable source/stage labels, phone and blanks normalize consistently", !normalized.errors.length && normalized.values.source === "open_house" && normalized.values.stage === "active_client" && normalized.values.phone === "+19545550123" && normalized.values.company === undefined && normalized.values.about === "private");
  check("invalid enums, email, phone and bounded fields identify row fields", normalizeImportRow(raw({ email: "bad", phone: "abc", stage: "maybe", source: "unknown", about: "x".repeat(2001) })).errors.length === 5);
  await db.insert(dashboardUsers).values([owner, other, admin].map(actor => ({ id: actor.userId, clerkUserId: `user_import${actor.userId.replaceAll("-", "")}`, primaryEmail: `${actor.userId}@example.test`, status: "active" as const, role: actor.role })));
  let p = await preview([raw({ fullName: "New Synthetic", email: "new@example.test", notes: "Private imported note", about: "Private about context" })]);
  check("preview is read-only and a valid unmatched row defaults to add", await count("contacts") === 0 && p.rows[0].recommendedDecision === "add" && p.counts.valid === 1);
  const request = commitInput(p); const added = await commitContactImport(ctx, request, now);
  check("commit creates one caller-owned contact and append-only note", added.ok && added.value.counts.added === 1 && await count("contacts") === 1 && await count("contact_notes") === 1 && await count("contact_import_requests") === 1);
  const [created] = await db.select().from(contacts);
  check("import does not invent outreach or put CSV notes in the legacy note column", created.assignedAgentUserId === owner.userId && created.preferredName === "New Synthetic" && !created.lastContactAt && created.notes === null && created.about === "Private about context");
  const retried = await commitContactImport(ctx, request, now);
  if (retried.ok && added.ok) assert.deepEqual(retried.value, added.value);
  check("same request retry returns the exact receipt without duplicate notes", retried.ok && added.ok && await count("contact_notes") === 1);
  const mismatched = await commitContactImport(ctx, { ...request, engagementAcknowledged: true }, now);
  check("a request key cannot be reused with a changed payload", !mismatched.ok && mismatched.reason === "request_conflict");
  const receipts = JSON.stringify((await db.select().from(contactImportRequests)).map(receipt => receipt.result));
  const audits = JSON.stringify((await db.select().from(auditEvents)).map(audit => audit.safeMetadata));
  check("receipt and audit store only IDs/counts/field names, no client values", !/New Synthetic|new@example|Private imported|Private about/.test(receipts + audits));
  const matching = await preview([raw({ fullName: "New Synthetic", email: "NEW@EXAMPLE.TEST" })]);
  check("complete exact matches default to skip", matching.rows[0].recommendedDecision === "skip" && matching.rows[0].candidates.some(match => match.contact.id === created.id));
  const notSeparate = await commitContactImport(ctx, commitInput(matching, [{ decision: "add" }]), now);
  check("adding a reviewed exact duplicate requires createSeparate", !notSeparate.ok && notSeparate.reason === "conflict" && await count("contacts") === 1);
  const separate = await commitContactImport(ctx, commitInput(matching, [{ decision: "add", createSeparate: true }]), now);
  check("an explicit createSeparate choice creates a distinct contact", separate.ok && separate.value.counts.added === 1 && await count("contacts") === 2);
  await reset(); let target = await seed({ email: "existing@example.test", phoneE164: "+19545550123", company: "Keep company", notes: "Legacy private text", lastContactAt: now });
  await db.insert(contactNotes).values({ contactId: target, authorUserId: owner.userId, body: "Existing private note" });
  p = await preview([raw({ email: "existing@example.test", firstName: "", company: "", about: "New private context", notes: "Appended private note" })]);
  const updated = await commitContactImport(ctx, commitInput(p, [{ decision: "update", targetId: target, expectedUpdatedAt: now.toISOString() }]), now);
  const [after] = await db.select().from(contacts).where(eq(contacts.id, target));
  check("updates skip blanks and preserve prior notes and touch state", updated.ok && after.firstName === "Existing" && after.company === "Keep company" && after.notes === "Legacy private text" && after.lastContactAt?.toISOString() === now.toISOString());
  check("CSV notes append instead of overwrite", await count("contact_notes") === 2 && after.about === "New private context");
  p = await preview([raw({ email: "existing@example.test", firstName: "", company: "" })]);
  const unchangedVersion = after.updatedAt.toISOString(), noteCount = await count("contact_notes"), auditCount = await count("audit_events");
  const noChange = await commitContactImport(ctx, commitInput(p, [{ decision: "update", targetId: target, expectedUpdatedAt: unchangedVersion }]), now);
  check("blank-only updates are truthful no-ops, preserving revision and history", noChange.ok && noChange.value.counts.skipped === 1 && (await db.select().from(contacts).where(eq(contacts.id, target)))[0].updatedAt.toISOString() === unchangedVersion && await count("contact_notes") === noteCount && await count("audit_events") === auditCount);
  await reset(); p = await preview([raw({ fullName: "Invalid email", email: "bad" }), raw({ fullName: "Valid row" }, 3)]);
  check("preview reports field errors without discarding valid rows", p.counts.invalid === 1 && p.counts.valid === 1 && p.rows[0].errors.some(error => error.field === "email"));
  const skippedInvalid = await commitContactImport(ctx, commitInput(p), now);
  check("reviewed invalid rows can be skipped while valid rows commit", skippedInvalid.ok && skippedInvalid.value.counts.skipped === 1 && skippedInvalid.value.counts.added === 1 && await count("contacts") === 1);
  await reset(); target = await seed({ email: "stale@example.test" }); p = await preview([raw({ fullName: "Reviewed", email: "stale@example.test", company: "Draft" })]);
  await db.update(contacts).set({ company: "Competing", updatedAt: new Date(now.getTime() + 1) }).where(eq(contacts.id, target));
  const stale = await commitContactImport(ctx, commitInput(p, [{ decision: "update", targetId: target, expectedUpdatedAt: now.toISOString() }]), now);
  check("a stale reviewed match refuses the whole import before writing", !stale.ok && stale.reason === "conflict" && await count("contact_import_requests") === 0 && await count("audit_events") === 0);
  await reset(); p = await preview([raw({ fullName: "Two A", email: "same@example.test" }), raw({ fullName: "Two B", email: "same@example.test" }, 3)]);
  check("in-file exact duplicates warn and default to skip", p.rows.every(row => row.fileDuplicates.length === 1 && row.recommendedDecision === "skip"));
  const fileRefusal = await commitContactImport(ctx, commitInput(p, [{ decision: "add" }, { decision: "skip" }]), now);
  check("in-file duplicate creation also requires an explicit separate choice", !fileRefusal.ok && fileRefusal.reason === "conflict");
  for (const table of ["contacts", "contact_activities", "contact_notes", "audit_events"]) {
    await reset(); p = await preview([raw({ fullName: "Atomic A", notes: "Mandatory note" }), raw({ fullName: "Atomic B" }, 3)]);
    const release = await failOn(table); const failed = await commitContactImport(ctx, commitInput(p), now);
    check(`${table} failure rolls back every contact/history/note/receipt`, !failed.ok && failed.reason === "unavailable" && await count("contacts") === 0 && await count("contact_activities") === 0 && await count("contact_notes") === 0 && await count("audit_events") === 0 && await count("contact_import_requests") === 0);
    await release();
  }
  await reset(); p = await preview([raw({ fullName: "Concurrent import", email: "concurrent@example.test", notes: "One note" })]); const concurrentInput = commitInput(p);
  const concurrent = await Promise.all([commitContactImport(ctx, concurrentInput, now), commitContactImport(ctx, concurrentInput, now)]);
  check("concurrent identical retries recover one durable receipt", concurrent.every(result => result.ok) && await count("contacts") === 1 && await count("contact_notes") === 1 && await count("contact_import_requests") === 1);
  await reset(); p = await preview([raw({ fullName: "Race", email: "race@example.test" })]);
  const raceDb = beforeBatch(async () => { await seed({ email: "race@example.test" }); });
  const raced = await commitContactImport({ actor: owner, db: raceDb }, commitInput(p), now);
  check("an exact match arriving after service review is caught by the atomic receipt guard", !raced.ok && raced.reason === "conflict" && await count("contacts") === 1 && await count("contact_import_requests") === 0);
  await reset(); p = await preview([raw({ fullName: "Recovered response", notes: "Only once" })]);
  const lostDb = beforeBatch(async () => { throw new Error("Synthetic lost batch response"); }, true);
  const recovered = await commitContactImport({ actor: owner, db: lostDb }, commitInput(p), now);
  check("post-commit response failure recovers the stored result", recovered.ok && await count("contacts") === 1 && await count("contact_notes") === 1);
  await reset(); p = await preview([raw({ fullName: "Engaged", stage: "Representation" })]); const gated = commitInput(p);
  const unacknowledged = await commitContactImport(ctx, gated, now);
  check("import cannot create represented contacts without an actual PDF", !unacknowledged.ok && unacknowledged.reason === "engagement_required" && await count("contacts") === 0);
  const acknowledged = await commitContactImport(ctx, { ...gated, engagementAcknowledged: true }, now);
  check("a checkbox cannot substitute for a PDF on imported new contact", !acknowledged.ok && acknowledged.reason === "engagement_required" && await count("contacts") === 0);
  target=await seed({email:"engaged@example.test"});
  await db.insert(contactEngagementFiles).values({contactId:target,storagePath:`contact-engagements/${target}/${randomUUID()}.pdf`,filename:"Synthetic.pdf",contentType:"application/pdf",sizeBytes:50,sha256:"a".repeat(64),uploadedByUserId:owner.userId});
  p=await preview([raw({email:"engaged@example.test",stage:"Representation"})]);
  const actualProofInput=commitInput(p,[{decision:"update",targetId:target,expectedUpdatedAt:now.toISOString()}]);
  const missingAck=await commitContactImport(ctx,actualProofInput,now);check("existing PDF still needs explicit import acknowledgement",!missingAck.ok&&missingAck.reason==="engagement_acknowledgement_required");
  const actualProof=await commitContactImport(ctx,{...actualProofInput,engagementAcknowledged:true},now);check("existing imported contact can transition with actual current PDF and acknowledgement",actualProof.ok&&(await db.select().from(contacts))[0].stage==="representation"&&!(await db.select().from(contacts))[0].lastContactAt);
  const forbidden = await previewContactImport({ actor: { ...owner, role: "member" }, db }, { rows: [raw({ fullName: "Forbidden" })] });
  check("members cannot preview or import", !forbidden.ok && forbidden.reason === "forbidden");
  await reset(); await seed({ assignedAgentUserId: other.userId, email: "other@example.test" });
  const adminPreview = await preview([raw({ fullName: "Other book", email: "other@example.test" })], { actor: admin, db });
  check("admin duplicate preview is still restricted to the admin's own book", adminPreview.rows[0].candidates.length === 0);
  const adminAdded = await commitContactImport({ actor: admin, db }, commitInput(adminPreview), now);
  check("admin import creates only caller-owned records", adminAdded.ok && (await db.select().from(contacts).where(eq(contacts.assignedAgentUserId, admin.userId))).length === 1);
  await reset(); const keeper = await seed({ email: "canonical@example.test" }); const alias = await seed({ email: "old-alias@example.test", stage: "archived", mergedIntoContactId: keeper, mergedAt: now });
  p = await preview([raw({ fullName: "Alias match", email: "old-alias@example.test" })]);
  check("exact alias identifiers suggest only their canonical unmerged contact", p.rows[0].candidates.some(match => match.contact.id === keeper) && !p.rows[0].candidates.some(match => match.contact.id === alias));
  await db.update(contacts).set({ email: "changed-alias@example.test", updatedAt: new Date(now.getTime() + 1) }).where(eq(contacts.id, alias));
  const changedAlias = await commitContactImport(ctx, commitInput(p, [{ decision: "add", createSeparate: true }]), now);
  check("a changed reviewed alias invalidates commit", !changedAlias.ok && changedAlias.reason === "conflict" && await count("contact_import_requests") === 0);
  await db.insert(contactNotes).values({ contactId: alias, authorUserId: owner.userId, body: "Routed concurrent note" });
  check("late child writes route from same-book alias to canonical parent", (await db.select().from(contactNotes))[0].contactId === keeper);
  await reset();
  const many = Array.from({ length: 51 }, (_, index) => ({ id: randomUUID(), firstName: `Bounded ${index}`, email: "shared-many@example.test", assignedAgentUserId: owner.userId, brokerageKey: owner.brokerageKey, createdAt: now, updatedAt: now }));
  await db.insert(contacts).values(many);
  p = await preview([raw({ fullName: "Bounded preview", email: "shared-many@example.test" })]);
  check("preview bounds displayed candidates and truthfully signals additional matches", p.rows[0].candidates.length === 50 && p.rows[0].candidateHasMore === true && p.rows[0].recommendedDecision === "skip");
  const displayed = new Set(p.rows[0].candidates.map(match => match.contact.id)), hidden = many.find(contact => !displayed.has(contact.id))!;
  await db.update(contacts).set({ company: "Concurrent undisplayed change", updatedAt: new Date(now.getTime() + 1) }).where(eq(contacts.id, hidden.id));
  const hiddenChanged = await commitContactImport(ctx, commitInput(p, [{ decision: "add", createSeparate: true }]), now);
  check("undisplayed exact matches still participate in review and commit protection", !hiddenChanged.ok && hiddenChanged.reason === "conflict" && await count("contact_import_requests") === 0 && await count("contacts") === 51);
  console.log(`${checks}/${checks} contact import checks passed (parser and isolated PostgreSQL)`);
} finally { await pg.close(); }
