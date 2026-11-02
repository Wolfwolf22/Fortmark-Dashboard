// Isolated equivalents of the production import/merge adapters. All decisions
// use production pure contracts; all writes end in ephemeral synthetic maps.
import { importPreviewInputSchema, importCommitInputSchema, normalizeImportRow, IMPORT_LIMITS } from "../../lib/contacts/import.ts";
import { duplicateReasons, toDuplicateContact, normalizeDuplicateEmail, normalizeDuplicatePhone, duplicateSuggestionsFromContacts, decodeDuplicateCursor } from "../../lib/contacts/duplicates.ts";
import { contactMergeInputSchema, mergeConflicts, defaultMergeChoices, mergeValues, mergeCounts, chooseMergedAction, chooseMergedFollowUp } from "../../lib/contacts/merge.ts";
import { canTransition, requiresEngagementNotice, CONTACT_STAGE_LABELS } from "../../lib/contacts/stages.ts";
import { bumpDataVersion } from "../../lib/data/store.ts";
import { CONTACT_NOTE_MAX_LENGTH } from "../../lib/contacts/notes.ts";
import { toTimeline } from "../../lib/contacts/timeline.ts";
import { contactAgents } from "./contact-fixtures.mjs";
import { previewRecordId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { LeadsError } from "./contact-errors.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { readSampleContactShowings, reparentSampleShowings } from "./showing-model.mjs";
import { readSampleContactSavedTours, reparentSampleSavedTours } from "./saved-tour-model.mjs";
import { previewContactTransactionParties, reparentPreviewTransactionParties } from "./transaction-model.mjs";
import { SAMPLE_ACTOR, interactiveSamples, getPreviewScenario, readSampleRawContacts, readSampleContact, readSampleNotes, readSampleNeeds, readSampleTimeline, readSampleActivities, readSampleTransactionIds, readSampleOpportunities, readSampleContactListRows, readSampleContactPropertyLists, readSampleListPropertyRows, readSamplePropertyAudits, replaceSampleContact, replaceSampleNotes, replaceSampleNeeds, replaceSampleTimeline, replaceSampleTransactionIds, replaceSampleOpportunities, replaceSamplePropertyList, replaceSampleListPropertyRows, appendSampleTimeline, nextSampleRevision, readSampleReceipt, replaceSampleReceipt } from "./sample-session.mjs";

const copy = value => structuredClone(value);
const error = (code, status = 400) => new LeadsError(code, status);
function writableMode() { if (!interactiveSamples()) { announceReadOnly(); throw error("preview_read_only", 403); } }
const mergeConflictReads = new Set();
const ownBook = () => getPreviewScenario() === "empty" ? [] : readSampleRawContacts().filter(contact => contact.recordSource === "db" && contact.assignedAgentId === SAMPLE_ACTOR.userId && !contact.mergedIntoContactId).map(contact => getPreviewScenario() === "conflict" && mergeConflictReads.has(contact.id) ? { ...contact, updatedAt: new Date(Date.parse(contact.updatedAt) + 60_000).toISOString(), editable: { ...contact.editable, company: "Synthetic newer merge-review company" } } : contact);
const identity = contact => ({ ...contact, id: previewPublicRecordId(contact.id), firstName: contact.editable?.firstName, lastName: contact.editable?.lastName, preferredName: contact.editable?.preferredName, company: contact.editable?.company });
const bookStamp = () => JSON.stringify(ownBook());
const hasName = values => Boolean(values.firstName || values.lastName || values.preferredName);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, "0")).join(""); }
async function payloadHash(input) { const { requestId, ...payload } = input; return digest(JSON.stringify(canonical(payload))); }
let tail = Promise.resolve();
function serialized(work) { const result = tail.then(work); tail = result.catch(() => {}); return result; }
function parsed(schema, input, code) { const result = schema.safeParse(input); if (!result.success || new TextEncoder().encode(JSON.stringify(input)).length > IMPORT_LIMITS.bytes) throw error(code); return result.data; }
async function exactMatches(values) {
  const matches = ownBook().map(identity).sort((a, b) => a.id.localeCompare(b.id)).map(contact => ({ contact: toDuplicateContact(contact), reasons: duplicateReasons(values, contact).filter(reason => reason !== "similar_name") })).filter(match => match.reasons.length);
  const fingerprint = await digest(JSON.stringify(matches.map(match => [match.contact.id, match.contact.updatedAt, match.reasons, normalizeDuplicateEmail(match.contact.email), normalizeDuplicatePhone(match.contact.phone)])));
  return { matches, fingerprint };
}
function fileMatches(rows) {
  const normalized = rows.map(row => ({ rowNumber: row.rowNumber, ...normalizeImportRow(row).values }));
  return new Map(normalized.map(row => [row.rowNumber, normalized.filter(other => other.rowNumber !== row.rowNumber && ((row.email && row.email === other.email) || (row.phone && row.phone === other.phone))).map(other => other.rowNumber)]));
}
export async function previewContactImport(input) {
  const data = parsed(importPreviewInputSchema, input, "invalid_import"), stamp = bookStamp();
  const inFile = fileMatches(data.rows), rows = [];
  for (const row of data.rows) {
    const normalized = normalizeImportRow(row), exact = await exactMatches(normalized.values);
    const errors = [...normalized.errors];
    if (!hasName(normalized.values) && !exact.matches.length) errors.push({ field: "preferredName", message: "Add a first, last or full name before creating a contact." });
    const fileDuplicates = inFile.get(row.rowNumber) || [];
    const reviewFingerprint = await payloadHash({ actor: SAMPLE_ACTOR.userId, brokerage: SAMPLE_ACTOR.brokerageKey, normalized: normalized.values, exactFingerprint: exact.fingerprint, fileDuplicates });
    const exactIds = new Set(exact.matches.map(match => match.contact.id));
    const advisory = ownBook().map(identity).sort((a, b) => a.id.localeCompare(b.id)).filter(contact => !exactIds.has(contact.id) && duplicateReasons(normalized.values, contact).includes("similar_name")).map(contact => ({ contact: toDuplicateContact(contact), reasons: ["similar_name"] }));
    rows.push({ rowNumber: row.rowNumber, values: row.values, normalized: normalized.values, errors, candidates: [...exact.matches, ...advisory.slice(0, 10)], ...(advisory.length > 10 ? { candidateHasMore: true } : {}), fileDuplicates, reviewFingerprint, recommendedDecision: errors.length || exact.matches.length || fileDuplicates.length ? "skip" : "add" });
  }
  if (bookStamp() !== stamp) throw error("conflict", 409);
  return copy({ rows, counts: { total: rows.length, valid: rows.filter(row => !row.errors.length).length, invalid: rows.filter(row => row.errors.length).length, matched: rows.filter(row => row.candidates.length || row.fileDuplicates.length).length } });
}
function storedFromValues(existing, values, id, at) {
  const editable = { firstName: existing?.editable?.firstName || "", lastName: existing?.editable?.lastName || "", preferredName: existing?.editable?.preferredName || "", company: existing?.editable?.company || "" };
  for (const field of ["firstName", "lastName", "preferredName", "company"]) if (values[field] !== undefined) editable[field] = values[field];
  const name = editable.preferredName || [editable.firstName, editable.lastName].filter(Boolean).join(" ") || "Unnamed contact";
  const base = existing || { id, name, email: "", phone: "", stage: "lead", source: "other", intent: "other", assignedAgentId: SAMPLE_ACTOR.userId, assignedAgentName: "Sample Agent", ownedByViewer: true, recordSource: "db", createdDate: at, lastContactDate: at, notes: "", about: "", personalDetails: [], birthday: null };
  return { ...base, editable, name, ...Object.fromEntries(["email", "phone", "source", "stage", "about"].filter(field => values[field] !== undefined).map(field => [field, values[field]])), updatedAt: existing ? nextSampleRevision(existing.updatedAt) : at };
}
export async function commitContactImport(input) {
  writableMode(); const data = parsed(importCommitInputSchema, input, "invalid_import");
  return serialized(async () => {
    const hash = await payloadHash(data), receipt = readSampleReceipt("import", data.requestId);
    if (receipt) { if (receipt.hash !== hash) throw error("request_conflict", 409); return copy(receipt.result); }
    const stamp = bookStamp(), review = await previewContactImport({ rows: data.rows.map(({ rowNumber, values }) => ({ rowNumber, values })) });
    if (bookStamp() !== stamp) throw error("conflict", 409);
    const result = { rows: [], counts: { added: 0, updated: 0, skipped: 0 } }, changes = [], targets = new Set();
    for (const row of data.rows) {
      if (row.decision === "skip") { result.rows.push({ rowNumber: row.rowNumber, status: "skipped" }); result.counts.skipped++; continue; }
      const reviewed = review.rows.find(item => item.rowNumber === row.rowNumber), values = reviewed.normalized;
      if (normalizeImportRow(row).errors.length) throw error("invalid_import");
      if (reviewed.reviewFingerprint !== row.reviewFingerprint) throw error("conflict", 409);
      const existing = row.decision === "update" ? ownBook().find(contact => contact.id === previewRecordId(row.targetId)) : undefined;
      if (row.decision === "update") {
        if (targets.has(row.targetId)) throw error("invalid_import"); targets.add(row.targetId);
        if (!existing || Date.parse(existing.updatedAt) !== Date.parse(row.expectedUpdatedAt)) throw error("conflict", 409);
        if (values.stage && values.stage !== existing.stage && !canTransition(existing.stage, values.stage)) throw error("invalid_transition", 409);
      } else if (!hasName(values)) throw error("invalid_name");
      else if ((reviewed.candidates.some(match => match.reasons.some(reason => reason === "exact_email" || reason === "exact_phone")) || reviewed.fileDuplicates.length) && row.createSeparate !== true) throw error("conflict", 409);
      const stage = values.stage || existing?.stage || "lead";
      if (requiresEngagementNotice(existing?.stage || "lead", stage) && !data.engagementAcknowledged) throw error("invalid_import");
      const id = existing?.id || crypto.randomUUID(), at = new Date().toISOString(), contact = storedFromValues(existing, values, id, at);
      const changed = !existing || JSON.stringify({ ...existing, updatedAt: undefined }) !== JSON.stringify({ ...contact, updatedAt: undefined });
      if (existing && !changed && !values.notes) { result.rows.push({ rowNumber: row.rowNumber, status: "skipped", contactId: id }); result.counts.skipped++; continue; }
      changes.push({ contact, existing, values, at });
      const status = existing ? "updated" : "added"; result.rows.push({ rowNumber: row.rowNumber, status, contactId: id }); result.counts[status]++;
    }
    // No await between the final guards above and this atomic local commit.
    for (const { contact, existing, values, at } of changes) {
      replaceSampleContact(contact);
      if (!existing) appendSampleTimeline(contact.id, { id: crypto.randomUUID(), type: "created", title: "Contact added", at, by: "Sample Agent" });
      if (contact.stage !== (existing?.stage || "lead")) appendSampleTimeline(contact.id, { id: crypto.randomUUID(), type: "stage", title: `Stage changed to ${CONTACT_STAGE_LABELS[contact.stage]}`, at, by: "Sample Agent" });
      if (values.notes) {
        replaceSampleNotes(contact.id, [...readSampleNotes(contact.id), { id: crypto.randomUUID(), body: values.notes, createdAt: at, author: "Sample Agent", canDelete: true }]);
        appendSampleTimeline(contact.id, { id: crypto.randomUUID(), type: "note", title: "Added note", at, by: "Sample Agent" }, undefined, false);
      }
    }
    replaceSampleReceipt("import", data.requestId, { hash, result }); if (changes.length) bumpDataVersion();
    return copy(result);
  });
}
export async function getContactDuplicates(cursor) {
  const decoded = cursor ? decodeDuplicateCursor(cursor) : undefined;
  if (cursor && !decoded) throw error("invalid_request");
  return copy(duplicateSuggestionsFromContacts(ownBook().map(identity), { cursor: decoded }));
}
function pairRecords(primaryId, duplicateId) {
  primaryId = previewRecordId(primaryId); duplicateId = previewRecordId(duplicateId);
  if (primaryId === duplicateId) throw error("invalid_request");
  const records = ownBook(); const primary = records.find(contact => contact.id === primaryId), duplicate = records.find(contact => contact.id === duplicateId);
  if (!primary || !duplicate) throw error("not_found", 404);
  return [primary, duplicate];
}
function children(id) { return { notes: readSampleNotes(id), needs: readSampleNeeds(id), activities: readSampleActivities(id), opportunities: readSampleOpportunities(id), transactions: readSampleTransactionIds(id), transactionParties: previewContactTransactionParties(id), timeline: readSampleTimeline(id), properties: readSampleContactListRows(id), propertyLists: readSampleContactPropertyLists(id), propertyAudits: readSamplePropertyAudits(id), showings: readSampleContactShowings(id), savedTours: readSampleContactSavedTours(id) }; }
const propertyIdentity = item => `${item.listId}\u0000${item.dataset}\u0000${item.listingId}`;
const pairStamp = records => JSON.stringify(records.map(contact => ({ contact, children: children(contact.id) })));
async function reviewContact(contact) {
  const child = children(contact.id);
  const counts = Object.fromEntries(["notes", "needs", "activities", "opportunities", "transactions"].map(key => [key, child[key].length]));
  const visibleLists = new Set(child.propertyLists.filter(list => list.ownerUserId === SAMPLE_ACTOR.userId && !list.archivedAt).map(list => list.id));
  counts.properties = new Set(child.properties.filter(item => !item.removedAt && visibleLists.has(item.listId)).map(propertyIdentity)).size;
  counts.propertyLists = visibleLists.size;
  counts.showings = child.showings.filter(item => item.ownerUserId === SAMPLE_ACTOR.userId).length;
  counts.savedTours = child.savedTours.filter(item => item.ownerUserId === SAMPLE_ACTOR.userId).length;
  return { id: previewPublicRecordId(contact.id), name: contact.name, updatedAt: contact.updatedAt, historyFingerprint: await payloadHash(child),
    values: { name: { firstName: contact.editable?.firstName || "", lastName: contact.editable?.lastName || "", preferredName: contact.editable?.preferredName || "" }, email: contact.email || "", phone: contact.phone || "", company: contact.editable?.company || "", source: contact.source, stage: contact.stage, birthday: contact.birthday || null, about: contact.about || "", personalDetails: contact.personalDetails || [], legacyNotes: contact.notes || "" }, nextAction: contact.nextAction || null, nextFollowUpDate: contact.nextFollowUpDate, counts };
}
export async function getContactMergeReview(primaryId, duplicateId) {
  const records = pairRecords(primaryId, duplicateId), stamp = pairStamp(records);
  const [primary, duplicate] = await Promise.all(records.map(reviewContact));
  if (pairStamp(pairRecords(primaryId, duplicateId)) !== stamp) throw error("conflict", 409);
  const preservedCounts = mergeCounts(primary.counts, duplicate.counts);
  preservedCounts.transactions = new Set(records.flatMap(contact => readSampleTransactionIds(contact.id))).size;
  const visibleLists = new Set(records.flatMap(contact => readSampleContactPropertyLists(contact.id)).filter(list => list.ownerUserId === SAMPLE_ACTOR.userId && !list.archivedAt).map(list => list.id));
  preservedCounts.properties = new Set(records.flatMap(contact => readSampleContactListRows(contact.id)).filter(item => !item.removedAt && visibleLists.has(item.listId)).map(propertyIdentity)).size;
  preservedCounts.propertyLists = visibleLists.size;
  return copy({ primary, duplicate, conflicts: mergeConflicts(primary.values, duplicate.values), defaults: defaultMergeChoices(primary.values, duplicate.values), preservedCounts });
}
const unique = items => [...new Map(items.map(item => [typeof item === "string" ? item : item.id, item])).values()];
export async function mergeContacts(input) {
  if (getPreviewScenario() === "conflict" && !mergeConflictReads.has(previewRecordId(input?.primaryId))) {
    const [primary] = pairRecords(input.primaryId, input.duplicateId); mergeConflictReads.add(primary.id); throw error("conflict", 409);
  }
  writableMode(); const data = parsed(contactMergeInputSchema, input, "invalid_request");
  return serialized(async () => {
    const hash = await payloadHash(data), receipt = readSampleReceipt("merge", data.requestId);
    if (receipt) { if (receipt.hash !== hash) throw error("request_conflict", 409); return copy({ ...receipt.result, primary: readSampleContact(receipt.result.primary.id) }); }
    const records = pairRecords(data.primaryId, data.duplicateId), stamp = pairStamp(records);
    const review = await getContactMergeReview(data.primaryId, data.duplicateId);
    if (pairStamp(pairRecords(data.primaryId, data.duplicateId)) !== stamp || review.primary.updatedAt !== data.expectedPrimaryUpdatedAt || review.duplicate.updatedAt !== data.expectedDuplicateUpdatedAt || review.primary.historyFingerprint !== data.expectedPrimaryHistoryFingerprint || review.duplicate.historyFingerprint !== data.expectedDuplicateHistoryFingerprint) throw error("conflict", 409);
    const [primary, duplicate] = records, values = mergeValues(review, data.choices), nextAction = chooseMergedAction(review, data.nextActionChoice);
    if (data.nextActionChoice !== "none" && !review[data.nextActionChoice].nextAction && !review[data.nextActionChoice].nextFollowUpDate) throw error("invalid_merge");
    if (values.stage !== primary.stage && !canTransition(primary.stage, values.stage)) throw error("invalid_transition", 409);
    if (requiresEngagementNotice(primary.stage, values.stage) && !data.engagementAcknowledged) throw error("invalid_request");
    const at = nextSampleRevision(primary.updatedAt), editable = { ...values.name, company: values.company };
    const lastTouchDate = [primary.lastTouchDate, duplicate.lastTouchDate].filter(Boolean).sort().at(-1);
    const merged = { ...primary, editable, name: editable.preferredName || [editable.firstName, editable.lastName].filter(Boolean).join(" ") || "Unnamed contact", email: values.email, phone: values.phone, source: values.source, stage: values.stage, birthday: values.birthday, about: values.about, personalDetails: values.personalDetails, notes: values.legacyNotes, nextAction, nextFollowUpDate: chooseMergedFollowUp(review, data.nextActionChoice) || undefined, createdDate: [primary.createdDate, duplicate.createdDate].sort()[0], lastTouchDate, lastContactDate: lastTouchDate || [primary.lastContactDate, duplicate.lastContactDate].sort().at(-1), updatedAt: at };
    const p = children(primary.id), d = children(duplicate.id);
    replaceSampleContact(merged);
    replaceSampleContact({ ...duplicate, stage: "archived", nextAction: null, nextFollowUpDate: undefined, mergedIntoContactId: primary.id, updatedAt: nextSampleRevision(duplicate.updatedAt) });
    replaceSampleNotes(primary.id, unique([...p.notes, ...d.notes])); replaceSampleNotes(duplicate.id, []);
    replaceSampleNeeds(primary.id, unique([...p.needs, ...d.needs])); replaceSampleNeeds(duplicate.id, []);
    replaceSampleTimeline(primary.id, unique([...p.timeline, ...d.timeline])); replaceSampleTimeline(duplicate.id, []);
    replaceSampleOpportunities(primary.id, unique([...p.opportunities, ...d.opportunities])); replaceSampleOpportunities(duplicate.id, []);
    replaceSampleTransactionIds(primary.id, unique([...p.transactions, ...d.transactions])); replaceSampleTransactionIds(duplicate.id, []);
    reparentSampleShowings(duplicate.id, primary.id);
    reparentSampleSavedTours(duplicate.id, primary.id);
    reparentPreviewTransactionParties(duplicate.id, primary.id);
    // Named lists remain separate collections. The same property may be saved
    // in both; only their optional contact association moves to the keeper.
    for (const list of d.propertyLists) {
      replaceSamplePropertyList({ ...list, contactId: primary.id });
      replaceSampleListPropertyRows(list.id, readSampleListPropertyRows(list.id).map(item => ({ ...item, contactId: primary.id })));
    }
    for (const record of [review.primary, review.duplicate]) {
      if (record.nextAction && record.nextAction.id !== nextAction?.id) {
        const action = record.nextAction;
        const item = toTimeline({ activities: [{ id: crypto.randomUUID(), kind: "task", summary: "Next action cancelled", occurredAt: new Date(at), actorUserId: SAMPLE_ACTOR.userId, safeMetadata: { event: "next_action_cancelled", actionId: action.id, kind: action.kind, purpose: action.purpose, dueAt: action.dueAt, assigneeId: action.assigneeId, reason: "Not selected during the reviewed contact merge." } }], followUpEvents: [], names: new Map(contactAgents.map(agent => [agent.id, agent.name])) })[0];
        appendSampleTimeline(primary.id, item);
      }
      const legacy = record.values.legacyNotes;
      if (legacy && legacy !== values.legacyNotes) for (let offset = 0; offset < legacy.length; offset += CONTACT_NOTE_MAX_LENGTH) {
        replaceSampleNotes(primary.id, [...readSampleNotes(primary.id), { id: crypto.randomUUID(), body: legacy.slice(offset, offset + CONTACT_NOTE_MAX_LENGTH), createdAt: at, author: "Sample Agent", canDelete: true }]);
        appendSampleTimeline(primary.id, { id: crypto.randomUUID(), type: "note", title: "Added note", at, by: "Sample Agent" }, undefined, false);
      }
    }
    const mergedEvent = toTimeline({ activities: [{ id: crypto.randomUUID(), kind: "task", summary: "Contact files merged", occurredAt: new Date(at), actorUserId: SAMPLE_ACTOR.userId, safeMetadata: { event: "contact_merged", mergedContactId: duplicate.id } }], followUpEvents: [], names: new Map(contactAgents.map(agent => [agent.id, agent.name])) })[0];
    appendSampleTimeline(primary.id, mergedEvent, "Contact files merged");
    for (const source of readSampleRawContacts().filter(contact => contact.mergedIntoContactId === duplicate.id)) replaceSampleContact({ ...source, mergedIntoContactId: primary.id, updatedAt: nextSampleRevision(source.updatedAt) });
    const result = { primary: readSampleContact(primary.id), preservedCounts: review.preservedCounts, mergedContactId: duplicate.id };
    replaceSampleReceipt("merge", data.requestId, { hash, result }); bumpDataVersion();
    return copy(result);
  });
}
