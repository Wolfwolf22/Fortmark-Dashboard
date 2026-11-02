// One ephemeral transaction book shared by the real board/file adapters,
// Home metrics and contact links. Every mutation stays in synthetic memory.
import { sampleTransactionBundles, previewTransactionId, previewTransactionPublicId } from "./transaction-fixtures.mjs";
import { toTransaction } from "../../lib/transactions/projection.ts";
import { createTransactionSchema, stageChangeSchema, initialDeadlines } from "../../lib/transactions/validation.ts";
import { transactionDetailsSchema, updateTransactionWorkspaceSchema, transactionDeadlineMutationSchema } from "../../lib/transactions/workspace-domain.ts";
import { canTransition, isTerminalStage, STAGE_LABELS } from "../../lib/transactions/stages.ts";
import { calendarDayKey, transactionDeadlineState } from "../../lib/transactions/calendar-days.ts";
import { DEFAULT_TRANSACTION_CHECKLIST, TRANSACTION_CHECKLIST_VERSION, transactionChecklistMutationSchema, checklistProgress, checklistBlockers, checklistMissingStages } from "../../lib/transactions/checklist-domain.ts";
import { canonicalTourFingerprint } from "../../lib/showings/tour-domain.ts";
import { SAMPLE_ACTOR, getPreviewScenario, interactiveSamples, readSampleContact, readSampleTransactionIds, replaceSampleTransactionIds, appendSampleTimeline, nextSampleRevision } from "./sample-session.mjs";
import { previewRecordId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { contactAgents } from "./contact-fixtures.mjs";
import { announceReadOnly } from "./read-only.mjs";

const copy = value => structuredClone(value), records = new Map(sampleTransactionBundles.map(bundle => [bundle.row.id, copy(bundle)])), receipts = new Map(), homeEvents = new Set(), remoteReads = new Set();
let chain = Promise.resolve(), failedOnce = false;
const serialized = work => { const value = chain.then(work, work); chain = value.catch(() => {}); return value; };
export class PreviewTransactionError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (code, status = 400) => { throw new PreviewTransactionError(code, status); };
const privileged = () => ["admin", "broker", "transaction_coordinator"].includes(SAMPLE_ACTOR.role);
const visible = bundle => bundle.row.brokerageKey === SAMPLE_ACTOR.brokerageKey && (privileged() || bundle.row.agentUserId === SAMPLE_ACTOR.userId);
const all = () => (interactiveSamples() ? [...records.values()] : sampleTransactionBundles).map(bundle => getPreviewScenario() === "conflict" && remoteReads.has(bundle.row.id) ? { ...copy(bundle), row: { ...bundle.row, notes: "The sample file was revised by another editor. Review this newer version before applying your kept draft.", updatedAt: new Date(Date.parse(bundle.row.updatedAt) + 60000).toISOString() } } : bundle);
function load(id) { const bundle = all().find(item => item.row.id === previewTransactionId(id)); if (!bundle || !visible(bundle)) fail("not_found", 404); return copy(bundle); }
function writable(bundle, terminal = true) { if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403); if (!visible(bundle)) fail("not_found", 404); if (terminal && isTerminalStage(bundle.row.stage)) fail("invalid_transition", 409); }
function writeMode(id) {
  if (getPreviewScenario() === "conflict" && id && !remoteReads.has(previewTransactionId(id))) { load(id); remoteReads.add(previewTransactionId(id)); fail("conflict", 409); }
  if (!interactiveSamples()) { announceReadOnly(); fail("preview_read_only", 403); }
}
function parse(schema, input) { const parsed = schema.safeParse(input); if (!parsed.success) fail("invalid_transaction"); return parsed.data; }
function revision(actual, expected) { if (Date.parse(actual) !== Date.parse(expected)) fail("conflict", 409); }
const asDate = value => value ? new Date(value) : null;
function project(bundle, now = new Date()) {
  const row = { ...bundle.row, createdAt: new Date(bundle.row.createdAt), updatedAt: new Date(bundle.row.updatedAt) };
  const deadlines = bundle.deadlines.map(item => ({ ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt), completedAt: asDate(item.completedAt), removedAt: asDate(item.removedAt) }));
  const agentName = contactAgents.find(agent => agent.id === row.agentUserId)?.name || "Sample Agent";
  return { ...toTransaction({ row, parties: bundle.parties, deadlines, agentName }, now), id: previewTransactionPublicId(row.id) };
}
export function getPreviewTransaction(id, now = new Date()) { return project(load(id), now); }
export function readPreviewTransactionBundles() { return copy(all().filter(visible)); }
export function listPreviewTransactions(filters = {}, range, now = new Date()) {
  if (getPreviewScenario() === "unavailable" && !failedOnce) { failedOnce = true; fail("preview_first_read_unavailable", 503); }
  return all().filter(visible).filter(bundle => {
    const row = bundle.row;
    if (filters.stage?.length && !filters.stage.includes(row.stage) || filters.side?.length && !filters.side.includes(row.side) || filters.agentId && filters.agentId !== row.agentUserId) return false;
    if (filters.query && !`${row.addressLine1} ${row.city} ${bundle.parties.map(party => party.displayName).join(" ")}`.toLowerCase().includes(filters.query.toLowerCase().trim())) return false;
    return !range || [row.contractExecutionDate, row.closingDate].some(day => day && day >= range.from.toISOString().slice(0, 10) && day <= range.to.toISOString().slice(0, 10));
  }).sort((a, b) => (a.row.closingDate || "9999").localeCompare(b.row.closingDate || "9999") || b.row.createdAt.localeCompare(a.row.createdAt)).slice(0, 200).map(bundle => project(bundle, now));
}
const detailKeys = Object.keys(transactionDetailsSchema.shape);
function workspace(bundle, historyPage = 1, now = new Date()) {
  if (!Number.isInteger(historyPage) || historyPage < 1 || historyPage > 1000000) fail("invalid_transaction");
  const history = [...bundle.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), page = Math.min(historyPage, Math.max(1, Math.ceil(history.length / 20)));
  return { transaction: project(bundle, now), details: Object.fromEntries(detailKeys.map(key => [key, key === "notes" ? bundle.row.notes || "" : bundle.row[key]])),
    deadlines: bundle.deadlines.filter(item => !item.removedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)).map(item => ({ id: item.id, kind: item.kind, label: item.label, dueDate: item.dueDate, note: item.note || "", completedAt: item.completedAt, updatedAt: item.updatedAt, state: transactionDeadlineState(item.dueDate, item.completedAt, now) })),
    checklist: { templateVersion: bundle.row.checklistTemplateVersion, items: [...bundle.checklist].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map(({ id, templateKey, label, stage, required, sortOrder, completedAt, updatedAt }) => ({ id, templateKey, label, stage, required, sortOrder, completedAt, updatedAt })), progress: checklistProgress(bundle.checklist) },
    parties: bundle.parties.map(party => { const contact = party.contactId ? readSampleContact(party.contactId) : null, canOpen = Boolean(contact?.recordSource === "db" && (SAMPLE_ACTOR.role === "admin" || contact.assignedAgentId === SAMPLE_ACTOR.userId)); return { id: party.id, role: party.role, displayName: party.displayName, company: party.company, email: party.email, phone: party.phone || null, isPrimary: party.isPrimary, contactId: canOpen ? previewPublicRecordId(contact.id) : null, canOpenContact: canOpen }; }),
    history: { items: history.slice((page - 1) * 20, page * 20), total: history.length, page, pageSize: 20 }, canEdit: SAMPLE_ACTOR.role !== "member" && !isTerminalStage(bundle.row.stage), updatedAt: bundle.row.updatedAt };
}
export function getPreviewTransactionWorkspace(id, options = {}, now = new Date()) { return workspace(load(id), options.historyPage || 1, now); }
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTourFingerprint(value))))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function begin(id, input, action) {
  const normalizedId = id ? previewTransactionId(id) : null, payloadHash = await hash({ id: normalizedId, input }), key = `${SAMPLE_ACTOR.userId}:${input.requestId}`, receipt = receipts.get(key);
  if (receipt) { const current = load(receipt.id); writable(current, false); if (receipt.action !== action || receipt.hash !== payloadHash) fail("request_conflict", 409); return { repeated: current }; }
  return { key, payloadHash };
}
function event(bundle, action, fields, now, extra = {}) {
  const item = { id: crypto.randomUUID(), eventType: action === "create" ? "transaction_created" : action === "stage" ? "transaction_stage_changed" : "transaction_updated", action, fields, createdAt: now.toISOString(), ...extra };
  bundle.history.push(item); if (action === "create" || action === "stage") homeEvents.add(item.id);
}
function save(bundle, started, action) { records.set(bundle.row.id, copy(bundle)); receipts.set(started.key, { id: bundle.row.id, action, hash: started.payloadHash }); }
function activeDeadlines(bundle) { return bundle.deadlines.filter(item => !item.removedAt); }
function closingMetadata(bundle, day, next) {
  if (day === bundle.row.closingDate) return;
  const closing = activeDeadlines(bundle).filter(item => item.kind === "closing"); if (closing.length > 1) fail("closing_deadline_conflict", 409);
  const current = closing[0]; if (current?.completedAt && current.dueDate !== day) fail("closing_deadline_conflict", 409);
  if (current) Object.assign(current, day ? { dueDate: day, updatedAt: next } : { removedAt: next, updatedAt: next });
  else if (day) bundle.deadlines.push({ id: crypto.randomUUID(), transactionId: bundle.row.id, kind: "closing", label: "Closing", dueDate: day, note: "", sortOrder: Math.max(0, ...activeDeadlines(bundle).map(item => item.sortOrder + 1)), completedAt: null, removedAt: null, createdAt: next, updatedAt: next });
}
export function updatePreviewTransactionWorkspace(id, input, now = new Date()) {
  writeMode(id); const value = parse(updateTransactionWorkspaceSchema, input);
  return serialized(async () => { const started = await begin(id, value, "edit"); if (started.repeated) return workspace(started.repeated, 1, now); const bundle = load(id); writable(bundle); revision(bundle.row.updatedAt, value.expectedUpdatedAt);
    const next = nextSampleRevision(bundle.row.updatedAt), fields = detailKeys.filter(key => (bundle.row[key] ?? (key === "notes" ? "" : null)) !== value.details[key]);
    closingMetadata(bundle, value.details.closingDate, next); Object.assign(bundle.row, value.details, { state: value.details.state.toUpperCase(), updatedAt: next, updatedByUserId: SAMPLE_ACTOR.userId }); event(bundle, "edit", fields, now); save(bundle, started, "edit"); return workspace(bundle, 1, now); });
}
export function mutatePreviewTransactionDeadline(id, input, now = new Date()) {
  writeMode(id); const value = parse(transactionDeadlineMutationSchema, input), action = `${value.action}_deadline`;
  return serialized(async () => { const started = await begin(id, value, action); if (started.repeated) return workspace(started.repeated, 1, now); const bundle = load(id); writable(bundle); revision(bundle.row.updatedAt, value.expectedUpdatedAt);
    const live = activeDeadlines(bundle), current = value.action === "add" ? undefined : live.find(item => item.id === value.deadlineId);
    if (value.action !== "add" && !current) fail("not_found", 404); if (current) revision(current.updatedAt, value.expectedDeadlineUpdatedAt);
    if (value.action === "complete" && current.completedAt || value.action === "reopen" && !current.completedAt) fail("invalid_deadline_transition", 409);
    const otherClosing = live.filter(item => item.kind === "closing" && item.id !== current?.id); let closingDate = bundle.row.closingDate;
    if (value.action === "add" || value.action === "edit") {
      if (value.deadline.kind === "closing") { if (otherClosing.length || current?.completedAt && (current.kind !== "closing" || current.dueDate !== value.deadline.dueDate) || !current && closingDate && closingDate !== value.deadline.dueDate) fail("closing_deadline_conflict", 409); closingDate = value.deadline.dueDate; }
      else if (current?.kind === "closing") { if (current.completedAt || otherClosing.length || closingDate && closingDate !== current.dueDate) fail("closing_deadline_conflict", 409); closingDate = null; }
    } else if (current?.kind === "closing") {
      if (value.action === "remove") { if (current.completedAt) fail("closing_deadline_conflict", 409); if (!otherClosing.length && closingDate === current.dueDate) closingDate = null; }
      else if (otherClosing.length || closingDate !== current.dueDate) fail("closing_deadline_conflict", 409);
    }
    const next = nextSampleRevision(bundle.row.updatedAt);
    if (value.action === "add") bundle.deadlines.push({ id: crypto.randomUUID(), transactionId: bundle.row.id, ...value.deadline, note: value.deadline.note || "", completedAt: null, removedAt: null, sortOrder: Math.max(0, ...live.map(item => item.sortOrder + 1)), createdAt: now.toISOString(), updatedAt: next });
    else if (value.action === "edit") Object.assign(current, value.deadline, { note: value.deadline.note || "", updatedAt: next });
    else Object.assign(current, { ...(value.action === "remove" ? { removedAt: now.toISOString() } : { completedAt: value.action === "complete" ? now.toISOString() : null }), updatedAt: next });
    Object.assign(bundle.row, { closingDate, updatedAt: next, updatedByUserId: SAMPLE_ACTOR.userId }); event(bundle, action, value.deadline ? ["kind", "label", "dueDate", "note"] : [value.action === "remove" ? "removedAt" : "completedAt"], now); save(bundle, started, action); return workspace(bundle, 1, now); });
}
export function changePreviewTransactionStage(id, input, now = new Date()) {
  writeMode(id); const value = parse(stageChangeSchema, input); if (!value.requestId || !value.expectedUpdatedAt) fail("invalid_transaction");
  return serialized(async () => { const started = await begin(id, value, "stage"); if (started.repeated) return project(started.repeated, now); const bundle = load(id); writable(bundle, false); revision(bundle.row.updatedAt, value.expectedUpdatedAt); const from = bundle.row.stage; if (!canTransition(from, value.stage)) fail("invalid_transition", 409);
    if (checklistMissingStages(bundle.checklist, from, value.stage).length) fail("checklist_not_ready", 409);
    if (checklistBlockers(bundle.checklist, from, value.stage).length) fail("checklist_incomplete", 409);
    Object.assign(bundle.row, { stage: value.stage, updatedAt: nextSampleRevision(bundle.row.updatedAt), updatedByUserId: SAMPLE_ACTOR.userId, ...(value.stage === "closed" ? { closedDate: calendarDayKey(now) } : isTerminalStage(value.stage) ? { cancelledDate: calendarDayKey(now) } : {}) }); event(bundle, "stage", [], now, { fromStage: from, toStage: value.stage }); save(bundle, started, "stage"); return project(bundle, now); });
}
export function mutatePreviewTransactionChecklist(id, input, now = new Date()) {
  writeMode(id); const value = parse(transactionChecklistMutationSchema, input), action = `${value.action}_checklist`;
  return serialized(async () => { const started = await begin(id, value, action); if (started.repeated) return workspace(started.repeated, 1, now); const bundle = load(id); writable(bundle); revision(bundle.row.updatedAt, value.expectedUpdatedAt);
    const current = bundle.checklist.find(item => item.id === value.itemId); if (!current) fail("not_found", 404); revision(current.updatedAt, value.expectedItemUpdatedAt);
    if (value.action === "complete" && current.completedAt || value.action === "reopen" && !current.completedAt) fail("invalid_checklist_transition", 409);
    const next = nextSampleRevision(bundle.row.updatedAt), childNext = new Date(Math.max(Date.parse(next), Date.parse(current.updatedAt) + 1)).toISOString();
    Object.assign(current, { completedAt: value.action === "complete" ? now.toISOString() : null, completedByUserId: value.action === "complete" ? SAMPLE_ACTOR.userId : null, updatedAt: childNext });
    Object.assign(bundle.row, { updatedAt: next, updatedByUserId: SAMPLE_ACTOR.userId }); event(bundle, action, ["completedAt"], now); save(bundle, started, action); return workspace(bundle, 1, now); });
}
export function createPreviewTransaction(input, now = new Date()) {
  writeMode(); const normalized = { ...input, ...(input?.contactId && readSampleContact(input.contactId) ? { contactId: previewPublicRecordId(readSampleContact(input.contactId).id) } : {}) }, value = parse(createTransactionSchema, normalized); if (!value.requestId) fail("invalid_transaction");
  return serialized(async () => { const started = await begin(null, value, "create"); if (started.repeated) return project(started.repeated, now); if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403);
    const contact = value.contactId ? readSampleContact(value.contactId) : null; if (value.contactId && (!contact || contact.recordSource !== "db" || contact.stage !== "representation" || SAMPLE_ACTOR.role !== "admin" && contact.assignedAgentId !== SAMPLE_ACTOR.userId)) fail("invalid_contact");
    const agentUserId = privileged() && value.agentUserId || (contact && SAMPLE_ACTOR.role === "admin" ? contact.assignedAgentId : SAMPLE_ACTOR.userId); if (!contactAgents.some(agent => agent.id === agentUserId)) fail("invalid_assignee");
    if (contact && agentUserId !== contact.assignedAgentId && SAMPLE_ACTOR.role !== "admin") fail("invalid_contact");
    const enteredDeadlines = initialDeadlines(value), closing = enteredDeadlines.filter(deadline => deadline.kind === "closing");
    if (closing.length > 1 || value.closingDate && closing.some(deadline => deadline.dueDate !== value.closingDate)) fail("closing_deadline_conflict", 409);
    const id = crypto.randomUUID(), stamp = now.toISOString(), row = { id, brokerageKey: SAMPLE_ACTOR.brokerageKey, agentUserId, createdByUserId: SAMPLE_ACTOR.userId, updatedByUserId: SAMPLE_ACTOR.userId, stage: "offer", transactionType: value.transactionType, side: value.side, addressLine1: value.addressLine1, addressLine2: value.addressLine2 || null, city: value.city, state: (value.state || "FL").toUpperCase(), postalCode: value.postalCode || null, county: null, propertySubType: null, listingKey: value.listingKey || null, mlsNumber: value.mlsNumber || null, listPriceCents: value.listPriceCents ?? null, offerPriceCents: null, contractPriceCents: value.contractPriceCents ?? null, commissionRateBps: value.commissionRateBps ?? null, commissionFlatCents: value.commissionFlatCents ?? null, agentSplitBps: value.agentSplitBps ?? null, transactionFeeCents: null, referralFeeBps: null, referralPayee: null, commissionPaidCents: null, commissionPaidAt: null, contractExecutionDate: value.contractExecutionDate || null, effectiveDate: null, closingDate: value.closingDate || null, closedDate: null, possessionDate: null, cancelledDate: null, notes: value.notes || "", createdAt: stamp, updatedAt: stamp };
    row.stage = value.contractExecutionDate ? "under_contract" : "opportunity";
    row.checklistTemplateVersion = TRANSACTION_CHECKLIST_VERSION;
    row.closingDate = value.closingDate || closing[0]?.dueDate || null;
    const role = value.side === "listing" ? "seller" : value.side === "landlord" ? "landlord" : value.side === "tenant" ? "tenant" : "buyer";
    const partyInputs = [...(contact ? [{ role, displayName: contact.name, contactId: contact.id, isPrimary: true, email: contact.email, phone: contact.phone }] : []), ...(value.parties || []).filter(party => !contact || party.role !== role)];
    const parties = partyInputs.map(party => ({ id: crypto.randomUUID(), transactionId: id, role: party.role, displayName: party.displayName, company: party.company || null, email: party.email || null, phone: party.phone || null, contactId: party.contactId || null, isPrimary: party.isPrimary || false, createdAt: stamp, updatedAt: stamp }));
    const deadlines = enteredDeadlines.map((deadline, sortOrder) => ({ id: crypto.randomUUID(), transactionId: id, ...deadline, note: deadline.note || "", sortOrder, completedAt: null, removedAt: null, createdAt: stamp, updatedAt: stamp }));
    const checklist = DEFAULT_TRANSACTION_CHECKLIST.map(item => ({ ...item, id: crypto.randomUUID(), transactionId: id, completedAt: null, completedByUserId: null, createdAt: stamp, updatedAt: stamp }));
    const bundle = { row, parties, deadlines, checklist, history: [] }; event(bundle, "create", ["stage", "side", "transactionType"], now);
    if (contact) { replaceSampleTransactionIds(contact.id, [...new Set([...readSampleTransactionIds(contact.id), id])]); appendSampleTimeline(contact.id, { id: crypto.randomUUID(), type: "transaction", title: "Transaction linked", at: stamp, by: "Sample Agent" }, undefined, false); }
    save(bundle, started, "create"); return project(bundle, now); });
}
export function previewTransactionActivity() {
  if (!interactiveSamples()) return [];
  return all().filter(visible).flatMap(bundle => bundle.history.filter(item => homeEvents.has(item.id)).map(item => { const address = bundle.row.addressLine1, closed = item.action === "stage" && item.toStage === "closed"; return { id: `txn:${item.id}`, kind: item.action === "create" ? "transaction_created" : closed ? "transaction_closed" : "transaction_stage_changed", summary: item.action === "create" ? `Deal opened on ${address}` : closed ? `${STAGE_LABELS.closed} — ${address}` : `Stage changed on ${address}`, subject: address, at: item.createdAt, href: `/transactions/${encodeURIComponent(previewTransactionPublicId(bundle.row.id))}` }; }));
}
export function previewLinkedTransactions(ids) { const keys = new Set(ids.map(previewTransactionId)); return all().filter(bundle => visible(bundle) && keys.has(bundle.row.id)).map(bundle => { const dto = project(bundle); return { id: dto.id, address: dto.address, city: dto.city, stage: dto.stage }; }); }
export function reparentPreviewTransactionParties(from, to) { for (const bundle of records.values()) bundle.parties = bundle.parties.map(party => party.contactId === from ? { ...party, contactId: to } : party); }
export function previewContactTransactionParties(id) { return copy(all().flatMap(bundle => bundle.parties.filter(party => party.contactId === previewRecordId(id)))); }
