// One ephemeral transaction book shared by the real board/file adapters,
// Home metrics and contact links. Every mutation stays in synthetic memory.
import { sampleTransactionBundles, previewTransactionId, previewTransactionPublicId } from "./transaction-fixtures.mjs";
import { toTransaction } from "../../lib/transactions/projection.ts";
import { createTransactionSchema, stageChangeSchema, initialDeadlines } from "../../lib/transactions/validation.ts";
import { transactionDetailsSchema, updateTransactionWorkspaceSchema, transactionDeadlineMutationSchema } from "../../lib/transactions/workspace-domain.ts";
import { canTransition, isTerminalStage, STAGE_LABELS } from "../../lib/transactions/stages.ts";
import { calendarDayKey, transactionDeadlineState } from "../../lib/transactions/calendar-days.ts";
import { DEFAULT_TRANSACTION_CHECKLIST, TRANSACTION_CHECKLIST_VERSION, GC_CHECKLIST_TEMPLATE_VERSION, transactionChecklistMutationSchema, checklistProgress, checklistBlockers, checklistMissingStages, checklistAutomaticStage } from "../../lib/transactions/checklist-domain.ts";
import { transactionWorkflowMutationSchema, EMPTY_LISTING_PLAN, isListingSide } from "../../lib/transactions/workflow-domain.ts";
import { closeAcknowledgementSchema, CLOSE_ACKNOWLEDGEMENT_VERSION } from "../../lib/transactions/close-acknowledgement.ts";
import { canonicalTourFingerprint } from "../../lib/showings/tour-domain.ts";
import { SAMPLE_ACTOR, getPreviewScenario, interactiveSamples, readSampleContact, readSampleTransactionIds, replaceSampleTransactionIds, appendSampleTimeline, nextSampleRevision } from "./sample-session.mjs";
import { previewRecordId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { contactAgents } from "./contact-fixtures.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { previewAttachmentDefault, projectPreviewVendors } from "./transaction-operations.mjs";

const copy = value => structuredClone(value), records = new Map(sampleTransactionBundles.map(bundle => [bundle.row.id, copy(bundle)])), receipts = new Map(), homeEvents = new Set(), remoteReads = new Set();
let chain = Promise.resolve(), failedOnce = false;
const serialized = work => { const value = chain.then(work, work); chain = value.catch(() => {}); return value; };
export class PreviewTransactionError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (code, status = 400) => { throw new PreviewTransactionError(code, status); };
const privileged = () => ["admin", "broker", "transaction_coordinator"].includes(SAMPLE_ACTOR.role);
const visible = (bundle,includeDeleted=false) => (!bundle.row.deletedAt||includeDeleted) && bundle.row.brokerageKey === SAMPLE_ACTOR.brokerageKey && (privileged() || bundle.row.agentUserId === SAMPLE_ACTOR.userId);
const all = () => (interactiveSamples() ? [...records.values()] : sampleTransactionBundles).map(bundle => getPreviewScenario() === "conflict" && remoteReads.has(bundle.row.id) ? { ...copy(bundle), row: { ...bundle.row, notes: "The sample file was revised by another editor. Review this newer version before applying your kept draft.", updatedAt: new Date(Date.parse(bundle.row.updatedAt) + 60000).toISOString() } } : bundle);
function load(id, includeDeleted=false) { const bundle = all().find(item => item.row.id === previewTransactionId(id)); if (!bundle || !visible(bundle,includeDeleted)) fail("not_found", 404); return copy(bundle); }
function writable(bundle, terminal = true, receipt = false, includeDeleted=false) { if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403); if (!receipt && bundle.row.side === "gc") fail("gc_not_configured",409); if (!visible(bundle,includeDeleted)) fail("not_found", 404); if (terminal && isTerminalStage(bundle.row.stage)) fail("invalid_transition", 409); }
function writeMode(id) {
  if (getPreviewScenario() === "conflict" && id && !remoteReads.has(previewTransactionId(id))) { load(id); remoteReads.add(previewTransactionId(id)); fail("conflict", 409); }
  if (!interactiveSamples()) { announceReadOnly(); fail("preview_read_only", 403); }
}
function parse(schema, input) { const parsed = schema.safeParse(input); if (!parsed.success) fail("invalid_transaction"); return parsed.data; }
function revision(actual, expected) { if (Date.parse(actual) !== Date.parse(expected)) fail("conflict", 409); }
const asDate = value => value ? new Date(value) : null;
function project(bundle, now = new Date()) {
  const row = { ...bundle.row, createdAt: new Date(bundle.row.createdAt), updatedAt: new Date(bundle.row.updatedAt), listingLinkedAt: asDate(bundle.row.listingLinkedAt), deletedAt:asDate(bundle.row.deletedAt) };
  const deadlines = bundle.deadlines.map(item => ({ ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt), completedAt: asDate(item.completedAt), removedAt: asDate(item.removedAt) }));
  const agentName = contactAgents.find(agent => agent.id === row.agentUserId)?.name || "Sample Agent";
  return { ...toTransaction({ row, parties: bundle.parties, deadlines, agentName }, now), id: previewTransactionPublicId(row.id) };
}
export function getPreviewTransaction(id, now = new Date()) { return project(load(id), now); }
export function readPreviewTransactionBundles() { return copy(all().filter(bundle=>visible(bundle))); }
export function listPreviewTransactions(filters = {}, range, now = new Date()) {
  if (getPreviewScenario() === "unavailable" && !failedOnce) { failedOnce = true; fail("preview_first_read_unavailable", 503); }
  return all().filter(bundle=>visible(bundle,Boolean(filters.deleted))&&Boolean(bundle.row.deletedAt)===Boolean(filters.deleted)).filter(bundle => {
    const row = bundle.row;
    if (filters.stage?.length && !filters.stage.includes(row.stage) || filters.side?.length && !filters.side.includes(row.side) || filters.agentId && filters.agentId !== row.agentUserId) return false;
    if (filters.query && !`${row.addressLine1} ${row.city} ${row.mlsNumber || ""} ${bundle.parties.map(party => party.displayName).join(" ")}`.toLowerCase().includes(filters.query.toLowerCase().trim())) return false;
    return !range || [row.contractExecutionDate, row.closingDate].some(day => day && day >= range.from.toISOString().slice(0, 10) && day <= range.to.toISOString().slice(0, 10));
  }).sort((a, b) => (a.row.closingDate || "9999").localeCompare(b.row.closingDate || "9999") || b.row.createdAt.localeCompare(a.row.createdAt)).slice(0, 200).map(bundle => project(bundle, now));
}
function projectWorkflow(bundle){
 const row=bundle.row,writableFile=SAMPLE_ACTOR.role!=="member"&&!row.deletedAt,active=writableFile&&!isTerminalStage(row.stage)&&row.side!=="gc",requests=bundle.reopenRequests||[];
 return {deletedAt:row.deletedAt||null,deletedReason:row.deletedReason||null,listingPlan:copy(row.listingPlan||EMPTY_LISTING_PLAN),
 notes:(bundle.privateNotes||[]).filter(n=>!n.removedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).map(n=>({id:n.id,body:n.body,createdAt:n.createdAt,updatedAt:n.updatedAt,canEdit:active&&(SAMPLE_ACTOR.role==="admin"||n.authorUserId===SAMPLE_ACTOR.userId)})),
 openHouses:(bundle.openHouses||[]).filter(h=>!h.removedAt).sort((a,b)=>b.startsAt.localeCompare(a.startsAt)||a.id.localeCompare(b.id)).map(({removedAt,...h})=>copy(h)),
 reopenRequests:requests.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).map(r=>({id:r.id,reason:r.reason,status:r.status,decisionReason:r.decisionReason,previousClosedDate:r.previousClosedDate,createdAt:r.createdAt,updatedAt:r.updatedAt,canDecide:writableFile&&row.stage==="closed"&&SAMPLE_ACTOR.role==="admin"&&r.status==="pending"})),
 canArchive:writableFile&&["closed","cancelled","fell_through"].includes(row.stage),canRestore:SAMPLE_ACTOR.role!=="member"&&Boolean(row.deletedAt),canRequestReopen:writableFile&&row.stage==="closed"&&!requests.some(r=>r.status==="pending"),canManageHelp:active&&SAMPLE_ACTOR.role==="admin"};
}
const detailKeys = Object.keys(transactionDetailsSchema.shape);
function workspace(bundle, historyPage = 1, now = new Date()) {
  if (!Number.isInteger(historyPage) || historyPage < 1 || historyPage > 1000000) fail("invalid_transaction");
  const history = [...bundle.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), page = Math.min(historyPage, Math.max(1, Math.ceil(history.length / 20)));
  return { transaction: project(bundle, now), details: Object.fromEntries(detailKeys.map(key => [key, key === "notes" ? bundle.row.notes || "" : bundle.row[key]])),
    deadlines: bundle.deadlines.filter(item => !item.removedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)).map(item => ({ id: item.id, kind: item.kind, label: item.label, dueDate: item.dueDate, note: item.note || "", completedAt: item.completedAt, updatedAt: item.updatedAt, state: transactionDeadlineState(item.dueDate, item.completedAt, now) })),
    checklist: { templateVersion: bundle.row.checklistTemplateVersion, items: [...bundle.checklist].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map(({ id, templateKey, label, stage, required, attachmentRequired = false, attachments = [], sortOrder, completedAt, updatedAt,helpText="" }) => ({ id, templateKey, label, stage, required,helpText, attachmentRequired, attachments: attachments.filter(file => !file.removedAt).map(({removedAt,...file})=>file), sortOrder, completedAt, updatedAt })), progress: checklistProgress(bundle.checklist.map(item=>({...item,attachments:(item.attachments||[]).filter(file=>!file.removedAt)}))) },
    vendors: projectPreviewVendors(bundle), attachmentUploadsEnabled: bundle.row.side!=="gc"&&!bundle.row.deletedAt, canManageTransactionSetup: bundle.row.side!=="gc"&&!bundle.row.deletedAt&&SAMPLE_ACTOR.role === "admin",
    parties: bundle.parties.map(party => { const contact = party.contactId ? readSampleContact(party.contactId) : null, canOpen = Boolean(contact?.recordSource === "db" && (SAMPLE_ACTOR.role === "admin" || contact.assignedAgentId === SAMPLE_ACTOR.userId)); return { id: party.id, role: party.role, displayName: party.displayName, company: party.company, email: party.email, phone: party.phone || null, isPrimary: party.isPrimary, contactId: canOpen ? previewPublicRecordId(contact.id) : null, canOpenContact: canOpen }; }),
    history: { items: history.slice((page - 1) * 20, page * 20), total: history.length, page, pageSize: 20 }, canEdit: bundle.row.side !== "gc" && !bundle.row.deletedAt && SAMPLE_ACTOR.role !== "member" && !isTerminalStage(bundle.row.stage), updatedAt: bundle.row.updatedAt,workflow:projectWorkflow(bundle) };
}
export function getPreviewTransactionWorkspace(id, options = {}, now = new Date()) { return workspace(load(id,Boolean(options.includeDeleted)), options.historyPage || 1, now); }
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTourFingerprint(value))))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function begin(id, input, action, includeDeleted=false) {
  const normalizedId = id ? previewTransactionId(id) : null, payloadHash = await hash({ id: normalizedId, input }), key = `${SAMPLE_ACTOR.userId}:${input.requestId}`, receipt = receipts.get(key);
  if (receipt) { const current = load(receipt.id,includeDeleted); writable(current, false, true,includeDeleted); if (receipt.action !== action || receipt.hash !== payloadHash) fail("request_conflict", 409); return { repeated: current }; }
  return { key, payloadHash };
}
function event(bundle, action, fields, now, extra = {}) {
  const item = { id: crypto.randomUUID(), eventType: action === "create" ? "transaction_created" : action === "stage" ? "transaction_stage_changed" : "transaction_updated", action, fields, createdAt: now.toISOString(), ...extra };
  bundle.history.push(item); if (["create","stage","checklist_stage","reopen_stage"].includes(action)) homeEvents.add(item.id);
}
function save(bundle, started, action, result = {}) { records.set(bundle.row.id, copy(bundle)); receipts.set(started.key, { id: bundle.row.id, action, hash: started.payloadHash, ...result }); }
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
    if(bundle.row.listingDataset&&(value.details.listingKey!==bundle.row.listingKey||value.details.mlsNumber!==bundle.row.mlsNumber))fail("property_linked",409);
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
    Object.assign(bundle.row, { closingDate, updatedAt: next, updatedByUserId: SAMPLE_ACTOR.userId }); event(bundle, action, value.deadline ? ["kind", "label", "dueDate", "note"] : [value.action === "remove" ? "removedAt" : "completedAt"], now); save(bundle, started, action, value.action === "edit" ? { deadlineId: current.id } : {}); return workspace(bundle, 1, now); });
}
export function changePreviewTransactionStage(id, input, now = new Date()) {
  writeMode(id); const value = parse(stageChangeSchema, input); if (!value.requestId || !value.expectedUpdatedAt) fail("invalid_transaction");
  return serialized(async () => { const started = await begin(id, value, "stage"); if (started.repeated) return project(started.repeated, now); const bundle = load(id); writable(bundle, false); revision(bundle.row.updatedAt, value.expectedUpdatedAt); const from = bundle.row.stage; if (!canTransition(from, value.stage)) fail("invalid_transition", 409);
    if(value.stage==="closed"&&!closeAcknowledgementSchema.safeParse(value.closeAcknowledgement).success)fail("close_ack_required",409);
    if(["cancelled","fell_through","withdrawn"].includes(value.stage)&&!value.reason?.trim())fail("terminal_reason_required",409);
    if (checklistMissingStages(bundle.checklist, from, value.stage).length) fail("checklist_not_ready", 409);
    if (checklistBlockers(bundle.checklist.map(item=>({...item,attachments:(item.attachments||[]).filter(file=>!file.removedAt)})), from, value.stage).length) fail("checklist_incomplete", 409);
    Object.assign(bundle.row, { stage: value.stage, updatedAt: nextSampleRevision(bundle.row.updatedAt), updatedByUserId: SAMPLE_ACTOR.userId, ...(value.stage === "closed" ? { closedDate: calendarDayKey(now) } : isTerminalStage(value.stage) ? { cancelledDate: calendarDayKey(now) } : {}) }); if(value.reason){bundle.privateNotes??=[];bundle.privateNotes.push({id:crypto.randomUUID(),authorUserId:SAMPLE_ACTOR.userId,body:`${value.stage}: ${value.reason}`,createdAt:now.toISOString(),updatedAt:bundle.row.updatedAt,removedAt:null});} event(bundle, "stage", [], now, { fromStage: from, toStage: value.stage,...value.stage==="closed"?{mockAcknowledgementVersion:CLOSE_ACKNOWLEDGEMENT_VERSION}:{} }); save(bundle, started, "stage"); return project(bundle, now); });
}
export function mutatePreviewTransactionChecklist(id, input, now = new Date()) {
  writeMode(id); const value = parse(transactionChecklistMutationSchema, input), action = `${value.action}_checklist`;
  return serialized(async () => { const started = await begin(id, value, action); if (started.repeated) return workspace(started.repeated, 1, now); const bundle = load(id); writable(bundle); revision(bundle.row.updatedAt, value.expectedUpdatedAt);
    const current = bundle.checklist.find(item => item.id === value.itemId); if (!current) fail("not_found", 404); revision(current.updatedAt, value.expectedItemUpdatedAt);
    if (value.action === "complete" && current.completedAt || value.action === "reopen" && !current.completedAt) fail("invalid_checklist_transition", 409);
    if (value.action === "complete" && current.attachmentRequired && !(current.attachments||[]).some(file=>!file.removedAt)) fail("attachment_required",409);
    const next = nextSampleRevision(bundle.row.updatedAt), childNext = new Date(Math.max(Date.parse(next), Date.parse(current.updatedAt) + 1)).toISOString();
    Object.assign(current, { completedAt: value.action === "complete" ? now.toISOString() : null, completedByUserId: value.action === "complete" ? SAMPLE_ACTOR.userId : null, updatedAt: childNext });
    const stage=current.required?checklistAutomaticStage(bundle.row.stage,bundle.checklist.map(item=>({...item,attachments:(item.attachments||[]).filter(file=>!file.removedAt)})),value.action):bundle.row.stage,from=bundle.row.stage;
    Object.assign(bundle.row, { stage,updatedAt: next, updatedByUserId: SAMPLE_ACTOR.userId }); event(bundle, action, ["completedAt"], now);if(stage!==from)event(bundle,"checklist_stage",["stage"],now,{fromStage:from,toStage:stage}); save(bundle, started, action); return workspace(bundle, 1, now); });
}
export function createPreviewTransaction(input, now = new Date()) {
  writeMode(); const normalized = { ...input, ...(input?.contactId && readSampleContact(input.contactId) ? { contactId: previewPublicRecordId(readSampleContact(input.contactId).id) } : {}) }, value = parse(createTransactionSchema, normalized); if (!value.requestId) fail("invalid_transaction");
  return serialized(async () => { const started = await begin(null, value, "create"); if (started.repeated) return project(started.repeated, now); if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403);
    const isGc = value.side === "gc", contact = value.contactId ? readSampleContact(value.contactId) : null; if (value.contactId && (!contact || contact.recordSource !== "db" || !isGc || SAMPLE_ACTOR.role !== "admin" && contact.assignedAgentId !== SAMPLE_ACTOR.userId)) fail("invalid_contact");
    const agentUserId = isGc ? SAMPLE_ACTOR.userId : privileged() && value.agentUserId || (contact && SAMPLE_ACTOR.role === "admin" ? contact.assignedAgentId : SAMPLE_ACTOR.userId); if (!contactAgents.some(agent => agent.id === agentUserId)) fail("invalid_assignee");
    if (contact && agentUserId !== contact.assignedAgentId && SAMPLE_ACTOR.role !== "admin") fail("invalid_contact");
    const enteredDeadlines = isGc ? [] : initialDeadlines(value), closing = enteredDeadlines.filter(deadline => deadline.kind === "closing");
    if (closing.length > 1 || value.closingDate && closing.some(deadline => deadline.dueDate !== value.closingDate)) fail("closing_deadline_conflict", 409);
    const id = crypto.randomUUID(), stamp = now.toISOString(), row = { id, brokerageKey: SAMPLE_ACTOR.brokerageKey, agentUserId, createdByUserId: SAMPLE_ACTOR.userId, updatedByUserId: SAMPLE_ACTOR.userId, stage: "offer", transactionType: value.transactionType, side: value.side, addressLine1: value.addressLine1, addressLine2: value.addressLine2 || null, city: isGc ? "" : value.city, state: isGc ? "" : (value.state || "FL").toUpperCase(), postalCode: value.postalCode || null, county: null, propertySubType: null, listingKey: value.listingKey || null, mlsNumber: value.mlsNumber || null, listPriceCents: value.listPriceCents ?? null, offerPriceCents: null, contractPriceCents: value.contractPriceCents ?? null, commissionRateBps: value.commissionRateBps ?? null, commissionFlatCents: value.commissionFlatCents ?? null, agentSplitBps: value.agentSplitBps ?? null, transactionFeeCents: null, referralFeeBps: null, referralPayee: null, commissionPaidCents: null, commissionPaidAt: null, contractExecutionDate: value.contractExecutionDate || null, effectiveDate: null, closingDate: value.closingDate || null, closedDate: null, possessionDate: null, cancelledDate: null, notes: value.notes || "", createdAt: stamp, updatedAt: stamp };
    if(!isGc&&!isListingSide(value.side)&&(value.listingGoLiveDate||value.listingExpirationDate)||value.listingGoLiveDate&&value.listingExpirationDate&&value.listingExpirationDate<value.listingGoLiveDate)fail("invalid_transaction");
    row.deletedAt=null;row.deletedReason=null;row.listingPlan={...EMPTY_LISTING_PLAN,goLiveDate:value.listingGoLiveDate||null,expirationDate:value.listingExpirationDate||null,status:value.listingGoLiveDate?"active":"draft"};
    row.stage = value.contractExecutionDate ? "under_contract" : "opportunity";
    row.checklistTemplateVersion = isGc ? GC_CHECKLIST_TEMPLATE_VERSION : TRANSACTION_CHECKLIST_VERSION;
    row.closingDate = value.closingDate || closing[0]?.dueDate || null;
    const role = isGc ? "other" : value.side === "listing" ? "seller" : value.side === "landlord" ? "landlord" : value.side === "tenant" ? "tenant" : "buyer";
    const partyInputs = [...(contact ? [{ role, displayName: contact.name, contactId: contact.id, isPrimary: true, email: contact.email, phone: contact.phone }] : []), ...(isGc && !contact ? [{role:"other",displayName:value.clientName,isPrimary:true}] : value.parties || []).filter(party => !contact || party.role !== role)];
    const parties = partyInputs.map(party => ({ id: crypto.randomUUID(), transactionId: id, role: party.role, displayName: party.displayName, company: party.company || null, email: party.email || null, phone: party.phone || null, contactId: party.contactId || null, isPrimary: party.isPrimary || false, createdAt: stamp, updatedAt: stamp }));
    const deadlines = enteredDeadlines.map((deadline, sortOrder) => ({ id: crypto.randomUUID(), transactionId: id, ...deadline, note: deadline.note || "", sortOrder, completedAt: null, removedAt: null, createdAt: stamp, updatedAt: stamp }));
    const checklist = (isGc ? [] : DEFAULT_TRANSACTION_CHECKLIST).map(item => ({ ...item, attachmentRequired: previewAttachmentDefault(row.brokerageKey,item.templateKey), attachments: [], id: crypto.randomUUID(), transactionId: id, completedAt: null, completedByUserId: null, createdAt: stamp, updatedAt: stamp }));
    const bundle = { row, parties, deadlines, checklist, history: [] }; event(bundle, "create", ["stage", "side", "transactionType"], now);
    if (contact) { replaceSampleTransactionIds(contact.id, [...new Set([...readSampleTransactionIds(contact.id), id])]); appendSampleTimeline(contact.id, { id: crypto.randomUUID(), type: "transaction", title: "Transaction linked", at: stamp, by: "Sample Agent" }, undefined, false); }
    save(bundle, started, "create"); return project(bundle, now); });
}
export function previewTransactionActivity() {
  if (!interactiveSamples()) return [];
  return all().filter(bundle=>visible(bundle)).flatMap(bundle => bundle.history.filter(item => homeEvents.has(item.id)).map(item => { const address = bundle.row.addressLine1, closed = item.action === "stage" && item.toStage === "closed"; return { id: `txn:${item.id}`, kind: item.action === "create" ? "transaction_created" : closed ? "transaction_closed" : "transaction_stage_changed", summary: item.action === "create" ? `${bundle.row.side === "gc" ? "GC file" : "Deal"} opened on ${address}` : closed ? `${STAGE_LABELS.closed} — ${address}` : `Stage changed on ${address}`, subject: address, at: item.createdAt, href: `/transactions/${encodeURIComponent(previewTransactionPublicId(bundle.row.id))}` }; }));
}
export function previewLinkedTransactions(ids) { const keys = new Set(ids.map(previewTransactionId)); return all().filter(bundle => visible(bundle) && keys.has(bundle.row.id)).map(bundle => { const dto = project(bundle); return { id: dto.id, address: dto.address, city: dto.city, stage: dto.stage, ...(dto.side === "gc" ? {workflowLabel:"Setup pending"} : {}) }; }); }
export function readPreviewTransactionExtra(id, read) { return read(load(id)); }
/** Lifecycle exceptions require a scoped existing edit; the source writer still verifies the full hash. */
export function hasPreviewDeadlineEditReceipt(id, deadlineId, requestId) {
  const bundle = load(id), receipt = receipts.get(`${SAMPLE_ACTOR.userId}:${requestId}`);
  return Boolean(receipt && receipt.id === bundle.row.id && receipt.action === "edit_deadline" && receipt.deadlineId === deadlineId);
}
/** Extensions share the file lock, exact receipts and safe history with core writes. */
export function mutatePreviewTransactionExtra(id, input, action, work, now = new Date()) {
  writeMode(id);
  return serialized(async()=>{const started=await begin(id,input,action);if(started.repeated)return workspace(started.repeated,1,now);const bundle=load(id);writable(bundle);revision(bundle.row.updatedAt,input.expectedUpdatedAt);const next=nextSampleRevision(bundle.row.updatedAt);await work(bundle,next);writable(load(id));revision(load(id).row.updatedAt,input.expectedUpdatedAt);Object.assign(bundle.row,{updatedAt:next,updatedByUserId:SAMPLE_ACTOR.userId});event(bundle,action,action==="link_property"||action==="unlink_property"?["listingDataset","listingKey","mlsNumber"]:action==="link_tour"||action==="unlink_tour"?["tourId"]:action==="set_vendor"?["vendorId","vendorStatus"]:action==="edit_vendor_details"?["vendorDetails"]:action==="upload_vendor_attachment"||action==="remove_vendor_attachment"?["vendorAttachments"]:action==="set_attachment_requirement"?["attachmentRequired"]:["attachments"],now);save(bundle,started,action);return workspace(bundle,1,now);});
}
export function reparentPreviewTransactionParties(from, to) { for (const bundle of records.values()) bundle.parties = bundle.parties.map(party => party.contactId === from ? { ...party, contactId: to } : party); }
export function previewContactTransactionParties(id) { return copy(all().flatMap(bundle => bundle.parties.filter(party => party.contactId === previewRecordId(id)))); }

/** Exact receipt and file revision semantics over synthetic records; no external provider. */
export function mutatePreviewTransactionWorkflow(id,input,now=new Date()){
 writeMode(id);const parsed=transactionWorkflowMutationSchema.safeParse(input);if(!parsed.success)fail("invalid_workflow");const d=parsed.data;
 return serialized(async()=>{const started=await begin(id,d,"workflow",true);if(started.repeated)return workspace(started.repeated,1,now);const bundle=load(id,true),row=bundle.row;writable(bundle,false,false,true);revision(row.updatedAt,d.expectedUpdatedAt);
  if(Boolean(row.deletedAt)!==(d.action==="restore"))fail("workflow_not_allowed",409);
  if(isTerminalStage(row.stage)&&!["archive","restore","request_reopen","decide_reopen"].includes(d.action))fail("invalid_transition",409);
  const next=nextSampleRevision(row.updatedAt),stamp=now.toISOString();let fields=[],recordId;
  bundle.privateNotes??=[];bundle.openHouses??=[];bundle.reopenRequests??=[];
  if(d.action==="archive"){
   if(!["closed","cancelled","fell_through"].includes(row.stage))fail("workflow_not_allowed",409);if(row.stage==="closed"&&!d.closedAcknowledged||row.stage!=="closed"&&!d.reason)fail("terminal_reason_required",409);
   row.deletedAt=stamp;row.deletedReason=d.reason||null;fields=["deletedAt","deletedReason"];
  }else if(d.action==="restore"){row.deletedAt=null;row.deletedReason=null;fields=["deletedAt"];
  }else if(d.action==="listing_plan"){
   if(!isListingSide(row.side))fail("workflow_not_allowed",409);const previous=row.listingPlan||EMPTY_LISTING_PLAN;if(d.plan.status==="extended"&&(!previous.expirationDate||!d.plan.expirationDate||d.plan.expirationDate<=previous.expirationDate))fail("invalid_workflow");row.listingPlan=copy(d.plan);fields=["listingPlan"];
  }else if(d.action==="add_party"){
   const contact=readSampleContact(d.contactId);if(!contact||contact.recordSource!=="db"||!privileged()&&contact.assignedAgentId!==SAMPLE_ACTOR.userId)fail("invalid_contact");revision(contact.updatedAt,d.expectedContactUpdatedAt);
   if(bundle.parties.length>=20||bundle.parties.some(p=>p.contactId===contact.id&&p.role===d.role))fail("conflict",409);
   recordId=crypto.randomUUID();bundle.parties.push({id:recordId,transactionId:row.id,contactId:contact.id,role:d.role,displayName:contact.name,company:null,email:contact.email||null,phone:contact.phone||null,isPrimary:false,createdAt:stamp});fields=["parties"];
  }else if(d.action==="checklist_help"){
   if(SAMPLE_ACTOR.role!=="admin")fail("forbidden",403);const item=bundle.checklist.find(item=>item.id===d.itemId);if(!item)fail("conflict",409);revision(item.updatedAt,d.expectedItemUpdatedAt);item.helpText=d.helpText;item.updatedAt=next;recordId=item.id;fields=["helpText"];
  }else if(d.action==="add_note"){
   if(bundle.privateNotes.filter(n=>!n.removedAt).length>=200)fail("conflict",409);recordId=crypto.randomUUID();bundle.privateNotes.push({id:recordId,authorUserId:SAMPLE_ACTOR.userId,body:d.body,createdAt:stamp,updatedAt:next,removedAt:null});fields=["privateNotes"];
  }else if(d.action==="edit_note"||d.action==="remove_note"){
   const note=bundle.privateNotes.find(n=>n.id===d.recordId&&!n.removedAt);if(!note||note.authorUserId!==SAMPLE_ACTOR.userId&&SAMPLE_ACTOR.role!=="admin")fail("conflict",409);revision(note.updatedAt,d.expectedRecordUpdatedAt);Object.assign(note,d.action==="edit_note"?{body:d.body,updatedAt:next}:{removedAt:stamp,updatedAt:next});recordId=note.id;fields=["privateNotes"];
  }else if(["add_open_house","edit_open_house","remove_open_house"].includes(d.action)){
   if(!isListingSide(row.side))fail("workflow_not_allowed",409);fields=["openHouses"];
   if(d.action==="add_open_house"){if(bundle.openHouses.filter(h=>!h.removedAt).length>=100)fail("conflict",409);recordId=crypto.randomUUID();bundle.openHouses.push({id:recordId,...copy(d.openHouse),startsAt:new Date(d.openHouse.startsAt).toISOString(),endsAt:new Date(d.openHouse.endsAt).toISOString(),createdAt:stamp,updatedAt:next,removedAt:null});}
   else{const house=bundle.openHouses.find(h=>h.id===d.recordId&&!h.removedAt);if(!house)fail("conflict",409);revision(house.updatedAt,d.expectedRecordUpdatedAt);Object.assign(house,d.action==="remove_open_house"?{removedAt:stamp,updatedAt:next}:{...copy(d.openHouse),startsAt:new Date(d.openHouse.startsAt).toISOString(),endsAt:new Date(d.openHouse.endsAt).toISOString(),updatedAt:next});recordId=house.id;}
  }else if(d.action==="request_reopen"){
   if(row.stage!=="closed")fail("workflow_not_allowed",409);if(bundle.reopenRequests.some(r=>r.status==="pending"))fail("reopen_pending",409);recordId=crypto.randomUUID();bundle.reopenRequests.push({id:recordId,reason:d.reason,status:"pending",decisionReason:null,previousClosedDate:row.closedDate,createdAt:stamp,updatedAt:next});fields=["reopenRequest"];
  }else if(d.action==="decide_reopen"){
   if(SAMPLE_ACTOR.role!=="admin")fail("forbidden",403);if(row.stage!=="closed")fail("workflow_not_allowed",409);const request=bundle.reopenRequests.find(r=>r.id===d.recordId&&r.status==="pending");if(!request)fail("conflict",409);revision(request.updatedAt,d.expectedRecordUpdatedAt);Object.assign(request,{status:d.approved?"approved":"denied",decisionReason:d.reason,updatedAt:next});recordId=request.id;fields=d.approved?["reopenRequest","stage","closedDate"]:["reopenRequest"];if(d.approved){row.stage="closing_prep";row.closedDate=null;}
  }
  Object.assign(row,{updatedAt:next,updatedByUserId:SAMPLE_ACTOR.userId});event(bundle,d.action,fields,now,{...recordId?{recordId}:{}});save(bundle,started,"workflow");if(d.action==="add_party"){const contact=readSampleContact(d.contactId);replaceSampleTransactionIds(contact.id,[...new Set([...readSampleTransactionIds(contact.id),row.id])]);}return workspace(bundle,1,now);
 });
}
