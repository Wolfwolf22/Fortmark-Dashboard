/** Launch-readiness regressions: real isolated PostgreSQL, in-memory private bytes, no network/env. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { dashboardUsers, transactions, transactionChecklistItems, transactionChecklistAttachments, brokerageVendors, transactionVendorEngagements, transactionVendorSelections, transactionVendorAttachments } from "../lib/db/schema.ts";
import { createTransaction, getTransaction, listTransactions, type TransactionContext } from "../lib/transactions/service.ts";
import { getTransactionWorkspace } from "../lib/transactions/workspace-service.ts";
import { listBrokerageVendors, createBrokerageVendor } from "../lib/transactions/vendor-service.ts";
import { getTransactionChecklistAttachment, getChecklistAttachmentDefaults, updateChecklistAttachmentDefault } from "../lib/transactions/attachment-service.ts";
import { getTransactionVendorAttachment, getTransactionVendorDetail } from "../lib/transactions/vendor-detail-service.ts";
import { DEFAULT_VENDOR_DETAIL_FIELDS } from "../lib/transactions/vendor-detail-domain.ts";
import type { TransactionFileStorage } from "../lib/transactions/transaction-file-storage.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const { pg, db } = await createLocalContactDb(), query = pg.query.bind(pg), now = new Date("2026-11-07T15:00:00Z");
const owner = { userId: randomUUID(), brokerageKey: "fortmark", role: "agent" as const }, other = { userId: randomUUID(), brokerageKey: "fortmark", role: "agent" as const }, admin = { userId: randomUUID(), brokerageKey: "fortmark", role: "admin" as const };
const ctx: TransactionContext = { actor: owner, db }, adminCtx: TransactionContext = { actor: admin, db };
const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
let reads = 0, cancels = 0;
const storage: TransactionFileStorage = { enabled: true, put: async () => { throw Error("Readiness test never uploads"); }, removeOrphan: async () => { throw Error("Readiness test never removes"); }, get: async () => { reads++; return { ok: true, sizeBytes: bytes.length, stream: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); }, cancel() { cancels++; } }) }; } };
async function duringQuery<T>(table: string, occurrence: number, change: () => Promise<void>, operation: () => Promise<T>): Promise<{ result: T; changed: boolean }> {
  let seen = 0, changed = false;
  pg.query = (async (...args: Parameters<typeof pg.query>) => { if (typeof args[0] === "string" && /^select\b/i.test(args[0]) && args[0].includes(`"${table}"`) && ++seen === occurrence) { changed = true; await change(); } return query(...args); }) as typeof pg.query;
  try { return { result: await operation(), changed }; } finally { pg.query = query; }
}
try {
  await db.insert(dashboardUsers).values([owner, other, admin].map((actor, i) => ({ id: actor.userId, role: actor.role, status: "active" as const, clerkUserId: `file-readiness-${i}`, primaryEmail: `file-readiness-${i}@example.test` })));
  const created = await createTransaction(ctx, { requestId: randomUUID(), side: "buyer", transactionType: "residential_sale", addressLine1: "Synthetic file readiness", city: "Sample" }, now);
  check("actualatomictransactioncreation", created.ok); const id = created.value.id;
  const [item] = await db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id));
  const checklistAttachmentId = randomUUID(), vendorAttachmentId = randomUUID(), detailId = randomUUID(), vendorId = randomUUID();
  const metadata = { transactionId: id, filename: "Private readiness report.pdf", contentType: "application/pdf", sizeBytes: bytes.length, sha256: "a".repeat(64), createdAt: now, updatedAt: now };
  await db.insert(transactionChecklistAttachments).values({ ...metadata, id: checklistAttachmentId, checklistItemId: item.id, storagePath: `transaction-files/${id}/${randomUUID()}.pdf` });
  await db.insert(brokerageVendors).values({ id: vendorId, brokerageKey: "fortmark", name: "Synthetic lender", categories: ["mortgage"], approved: true });
  await db.insert(transactionVendorEngagements).values({ id: detailId, transactionId: id, role: "mortgage", vendorId, vendorName: "Private lender", details: { ...DEFAULT_VENDOR_DETAIL_FIELDS, notes: "Private lender observations" } });
  await db.insert(transactionVendorSelections).values({ transactionId: id, role: "mortgage", status: "selected", vendorId, vendorName: "Private lender", detailId });
  await db.insert(transactionVendorAttachments).values({ ...metadata, id: vendorAttachmentId, detailId, kind: "pre_approval", storagePath: `transaction-files/${id}/${randomUUID()}.pdf` });
  for (const read of [() => getTransactionChecklistAttachment(ctx, id, checklistAttachmentId, storage), () => getTransactionVendorAttachment(ctx, id, vendorAttachmentId, storage)]) { const result = await read(); check("authorizedprivatebytesretained", result.ok); await result.value.stream.cancel(); }
  for (const [table, read] of [["transaction_checklist_attachments", () => getTransactionChecklistAttachment(ctx, id, checklistAttachmentId, storage)], ["transaction_vendor_attachments", () => getTransactionVendorAttachment(ctx, id, vendorAttachmentId, storage)]] as const) {
    for (const revocation of ["ownership", "status"] as const) {
      const beforeCancel = cancels, raced = await duringQuery(table, 2, async () => { if (revocation === "ownership") await db.update(transactions).set({ agentUserId: other.userId }).where(eq(transactions.id, id)); else await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, owner.userId)); }, read);
      check("finalattachmentmetadataqueryrecheckscurrentscope", raced.changed && !raced.result.ok && raced.result.reason === "not_found" && cancels === beforeCancel + 1);
      await db.update(transactions).set({ agentUserId: owner.userId }).where(eq(transactions.id, id)); await db.update(dashboardUsers).set({ status: "active" }).where(eq(dashboardUsers.id, owner.userId));
    }
  }
  const detailRace = await duringQuery("transaction_vendor_selections", 2, async () => { await db.update(transactions).set({ agentUserId: other.userId }).where(eq(transactions.id, id)); }, () => getTransactionVendorDetail(ctx, id, detailId));
  check("vendorassignmentreadcannotoutliveparentscope", detailRace.changed && !detailRace.result.ok && detailRace.result.reason === "not_found"); await db.update(transactions).set({ agentUserId: owner.userId }).where(eq(transactions.id, id));
  const defaults = await getChecklistAttachmentDefaults(adminCtx); check("activeadminreadssetupcapability", defaults.ok && defaults.value.canManage);
  const defaultsRace = await duringQuery("transaction_checklist_template_settings", 1, async () => { await db.update(dashboardUsers).set({ role: "member" }).where(eq(dashboardUsers.id, admin.userId)); }, () => getChecklistAttachmentDefaults(adminCtx));
  check("setupreadrechecksactoraftermetadataquery", defaultsRace.changed && !defaultsRace.result.ok && defaultsRace.result.reason === "forbidden"); await db.update(dashboardUsers).set({ role: "admin" }).where(eq(dashboardUsers.id, admin.userId));
  const updateInput = { requestId: randomUUID(), templateKey: "offer.terms", attachmentRequired: true, expectedUpdatedAt: null }, updated = await updateChecklistAttachmentDefault(adminCtx, updateInput, now); check("setupwritehasdurablereceipt", updated.ok);
  const replayRace = await duringQuery("transaction_setup_write_requests", 1, async () => { await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, admin.userId)); }, () => updateChecklistAttachmentDefault(adminCtx, updateInput, now));
  check("setupexactreplaydoesnotreturnstalecapability", replayRace.changed && !replayRace.result.ok && replayRace.result.reason === "forbidden");
  await db.update(dashboardUsers).set({ status: "active" }).where(eq(dashboardUsers.id, admin.userId));
  const basicRace = await duringQuery("transaction_parties", 1, async () => { await db.update(transactions).set({ agentUserId: other.userId }).where(eq(transactions.id, id)); }, () => getTransaction(ctx, id, now));
  check("basicfilerecheckscopeafterchildhydration", basicRace.changed && basicRace.result === null); await db.update(transactions).set({ agentUserId: owner.userId }).where(eq(transactions.id, id));
  const listRace = await duringQuery("transaction_deadlines", 1, async () => { await db.update(transactions).set({ agentUserId: other.userId }).where(eq(transactions.id, id)); }, () => listTransactions(ctx, {}, undefined, now));
  check("listdropsfileswithdrawnduringhydration", listRace.changed && listRace.result.length === 0); await db.update(transactions).set({ agentUserId: owner.userId }).where(eq(transactions.id, id));
  const workspaceRace = await duringQuery("transaction_events", 1, async () => { await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, owner.userId)); }, () => getTransactionWorkspace(ctx, id, {}, now));
  check("workspacefinalreadrefuseslatedisable", workspaceRace.changed && !workspaceRace.result.ok && workspaceRace.result.reason === "not_found"); await db.update(dashboardUsers).set({ status: "active" }).where(eq(dashboardUsers.id, owner.userId));
  await db.update(dashboardUsers).set({ role: "agent" }).where(eq(dashboardUsers.id, admin.userId));
  check("staleadmincannotreadbrokeragefilesafterdemotion", await getTransaction(adminCtx, id, now) === null && (await listTransactions(adminCtx, {}, undefined, now)).length === 0 && !(await getTransactionWorkspace(adminCtx, id, {}, now)).ok); await db.update(dashboardUsers).set({ role: "admin" }).where(eq(dashboardUsers.id, admin.userId));
  const directoryRace = await duringQuery("brokerage_vendors", 1, async () => { await db.update(dashboardUsers).set({ role: "member" }).where(eq(dashboardUsers.id, admin.userId)); }, () => listBrokerageVendors(adminCtx));
  check("directoryreadcannotreturnstaleadminchoices", directoryRace.changed && !directoryRace.result.ok && directoryRace.result.reason === "forbidden"); await db.update(dashboardUsers).set({ role: "admin" }).where(eq(dashboardUsers.id, admin.userId));
  const vendorInput = { requestId: randomUUID(), vendor: { name: "Private draft vendor", company: null, email: null, phone: null, categories: ["inspector"], approved: false } }, vendorCreated = await createBrokerageVendor(adminCtx, vendorInput, now); check("draftvendorreceiptfixturecommitted", vendorCreated.ok);
  const vendorReplay = await duringQuery("brokerage_vendor_write_requests", 1, async () => { await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, admin.userId)); }, () => createBrokerageVendor(adminCtx, vendorInput, now));
  check("vendorreceiptrecoveryreauthorizesbeforeprivatedraftprojection", vendorReplay.changed && !vendorReplay.result.ok && (vendorReplay.result.reason === "not_found" || vendorReplay.result.reason === "forbidden"));
  const noReads = reads, foreign = await getTransactionChecklistAttachment({ actor: other, db }, id, checklistAttachmentId, storage); check("foreignrefusalisbeforestorage", !foreign.ok && foreign.reason === "not_found" && reads === noReads);
  console.log(`${passed}/${passed} transaction file readiness checks passed (isolated PostgreSQL + fake bytes; no live access)`);
} finally { pg.query = query; await pg.close(); }
