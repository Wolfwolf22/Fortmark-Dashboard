// Closed, ephemeral projection of the same synthetic records used by every source screen.
import { CALENDAR_KINDS, CALENDAR_TIME_ZONE } from '../../lib/calendar/domain.ts';
import { readCalendarQuery, calendarQueryWindow, sortCalendarItems } from '../../lib/calendar/scheduling.ts';
import { calendarRescheduleInputSchema } from '../../lib/calendar/validation.ts';
import { businessDayKey } from '../../lib/metrics/business-day.ts';
import { OPEN_PIPELINE_STAGES } from '../../lib/contacts/stages.ts';
import { isTerminalStage } from '../../lib/transactions/stages.ts';
import { readAllSampleShowings, getSampleShowing, updateSampleShowing } from './showing-model.mjs';
import { readAllSampleSavedTours } from './saved-tour-model.mjs';
import { SAMPLE_ACTOR, readSampleContacts, readSampleContact, interactiveSamples, getPreviewScenario } from './sample-session.mjs';
import { previewPublicRecordId } from './import-merge-fixtures.mjs';
import { readPreviewTransactionBundles, readPreviewTransactionExtra, hasPreviewDeadlineEditReceipt, mutatePreviewTransactionDeadline } from './transaction-model.mjs';
import { previewTransactionPublicId } from './transaction-fixtures.mjs';
import { updateNextAction } from './contact-adapters.mjs';
import { decoratePreviewCalendarItems, getPreviewCalendarLabels, previewPersonalCalendarItems } from './personal-calendar-model.mjs';

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const canRead = person => person?.recordSource === 'db' && (SAMPLE_ACTOR.role === 'admin' || person.assignedAgentId === SAMPLE_ACTOR.userId);
const editable = () => SAMPLE_ACTOR.role !== 'member';
const day = value => businessDayKey(new Date(value));
let partialServed = false;
export function getPreviewCalendar(params, now = new Date()) {
  const q = readCalendarQuery(params), window = q && calendarQueryWindow(q);
  if (!q || !window) fail('invalid_calendar_query');
  const selected = q.kinds || CALENDAR_KINDS, items = [], sources = [];
  const pointIn = value => Date.parse(value) >= Date.parse(window.from) && Date.parse(value) < Date.parse(window.to);
  const dayIn = value => value >= q.fromDay && value < q.toDay;
  const today = businessDayKey(now);
  const base = (kind, id, title, subtitle, dayValue, sourceId, sourceHref, sourceLabel, status, extra = {}) => {
    const overdue = dayValue < today || kind === 'next_action' && extra.startsAt && Date.parse(extra.startsAt) < now.getTime();
    return { id: `${kind}:${id}`, kind, title, subtitle, day: dayValue, allDay: true, startsAt: null, endsAt: null, blocksTime: false, sourceId, sourceHref, sourceLabel, status: overdue && kind !== 'tour' && kind !== 'showing' ? 'overdue' : status, reschedule: null, ...extra };
  };
  const tours = readAllSampleSavedTours().filter(t => t.ownerUserId === SAMPLE_ACTOR.userId && !t.archivedAt && canRead(readSampleContact(t.contactId)));
  const all = {
    showing: () => readAllSampleShowings().filter(s => s.ownerUserId === SAMPLE_ACTOR.userId && s.status === 'scheduled' && canRead(readSampleContact(s.contactId)) && Date.parse(s.startsAt) < Date.parse(window.to) && Date.parse(s.endsAt) > Date.parse(window.from)).map(s => base('showing', s.id, `Showing · MLS ${s.mlsNumber}`, readSampleContact(s.contactId).name, day(s.startsAt), s.id, `/showings?showing=${s.id}`, 'Open showing', 'scheduled', { allDay: false, startsAt: s.startsAt, endsAt: s.endsAt, blocksTime: true, tourIds: tours.filter(t => t.stops.some(stop => stop.linkedShowingId === s.id)).map(t => t.id), reschedule: editable() ? { kind: 'showing', sourceId: s.id, expectedUpdatedAt: s.updatedAt } : null })),
    tour: () => tours.filter(t => pointIn(t.startsAt)).map(t => base('tour', t.id, t.name, readSampleContact(t.contactId).name, day(t.startsAt), t.id, `/showing-tours?tour=${t.id}`, 'Open tour plan', 'planned', { allDay: false, startsAt: t.startsAt })),
    next_action: () => readSampleContacts().filter(c => canRead(c) && OPEN_PIPELINE_STAGES.includes(c.stage) && c.nextAction?.assigneeId === SAMPLE_ACTOR.userId && pointIn(c.nextAction.dueAt)).map(c => base('next_action', c.nextAction.id, c.nextAction.purpose, c.name, day(c.nextAction.dueAt), previewPublicRecordId(c.id), `/contacts?open=${encodeURIComponent(c.id)}`, 'Open contact', 'pending', { allDay: false, startsAt: c.nextAction.dueAt, reschedule: editable() ? { kind: 'next_action', sourceId: previewPublicRecordId(c.id), expectedUpdatedAt: c.updatedAt, actionId: c.nextAction.id } : null })),
    reminder: () => readSampleContacts().filter(c => canRead(c) && c.assignedAgentId === SAMPLE_ACTOR.userId && OPEN_PIPELINE_STAGES.includes(c.stage) && !c.nextAction && c.nextFollowUpDate && dayIn(day(c.nextFollowUpDate))).map(c => base('reminder', previewPublicRecordId(c.id), 'Follow up', c.name, day(c.nextFollowUpDate), previewPublicRecordId(c.id), `/contacts?open=${encodeURIComponent(c.id)}`, 'Open contact', 'pending')),
    transaction_deadline: () => readPreviewTransactionBundles().filter(b => b.row.side !== 'gc' && !isTerminalStage(b.row.stage)).flatMap(b => {
      const row = b.row, href = `/transactions/${encodeURIComponent(previewTransactionPublicId(row.id))}`, active = b.deadlines.filter(d => !d.removedAt);
      const values = active.filter(d => !d.completedAt && dayIn(d.dueDate)).map(d => base('transaction_deadline', d.id, d.label, row.addressLine1, d.dueDate, row.id, href, 'Open transaction', 'pending', { reschedule: editable() ? { kind: 'transaction_deadline', sourceId: row.id, expectedUpdatedAt: row.updatedAt, deadlineId: d.id, expectedDeadlineUpdatedAt: d.updatedAt } : null }));
      if (row.closingDate && dayIn(row.closingDate) && !active.some(d => d.kind === 'closing')) values.push({...base('transaction_deadline', `closing:${row.id}`, 'Closing', row.addressLine1, row.closingDate, row.id, href, 'Open transaction', 'pending'),id:`closing:${row.id}`});
      return values;
    }),
    personal: () => previewPersonalCalendarItems(q, window),
  };
  const partial = getPreviewScenario() === "unavailable" && !partialServed;
  if (partial) partialServed = true;
  for (const kind of selected) {
    if (partial && kind === "transaction_deadline") { sources.push({ kind, status: "unavailable", total: null, truncated: false }); continue; }
    const rows = sortCalendarItems(all[kind]());
    sources.push({ kind, status: 'available', total: rows.length, truncated: rows.length > 200 });
    items.push(...rows.slice(0, 200));
  }
  return { items: decoratePreviewCalendarItems(sortCalendarItems(items)), sources, fromDay: q.fromDay, toDay: q.toDay, timeZone: CALENDAR_TIME_ZONE, generatedAt: now.toISOString(), labels:getPreviewCalendarLabels().labels,labelsStatus:'available' };
}
/** Opaque identity checks never grant access to another person's source or private metadata. */
export function previewCalendarAnnotationTarget(ref) {
  if(ref.kind==='showing'){const row=getSampleShowing(ref.sourceId);if(ref.id===`showing:${row.id}`)return;}
  else if(ref.kind==='tour'){const row=readAllSampleSavedTours().find(t=>t.id===ref.sourceId&&t.ownerUserId===SAMPLE_ACTOR.userId&&canRead(readSampleContact(t.contactId)));if(row&&ref.id===`tour:${row.id}`)return;}
  else if(ref.kind==='next_action'||ref.kind==='reminder'){const row=readSampleContact(ref.sourceId);if(canRead(row)&&previewPublicRecordId(row.id)===ref.sourceId&&OPEN_PIPELINE_STAGES.includes(row.stage)){
    if(ref.kind==='next_action'&&row.nextAction?.assigneeId===SAMPLE_ACTOR.userId&&ref.id===`next_action:${row.nextAction.id}`)return;
    if(ref.kind==='reminder'&&row.assignedAgentId===SAMPLE_ACTOR.userId&&!row.nextAction&&row.nextFollowUpDate&&ref.id===`reminder:${ref.sourceId}`)return;
  }}else if(ref.kind==='transaction_deadline'){const allowed=readPreviewTransactionExtra(ref.sourceId,bundle=>{if(bundle.row.side==='gc'||isTerminalStage(bundle.row.stage))return false;const active=bundle.deadlines.filter(d=>!d.removedAt);return active.some(d=>!d.completedAt&&ref.id===`transaction_deadline:${d.id}`)||Boolean(ref.id===`closing:${bundle.row.id}`&&bundle.row.closingDate&&!active.some(d=>d.kind==='closing'));});if(allowed)return;}
  fail('not_found',404);
}
export async function reschedulePreviewCalendar(input) {
  if (!interactiveSamples()) fail('preview_read_only', 403);
  if (!editable()) fail('forbidden', 403);
  const parsed = calendarRescheduleInputSchema.safeParse(input);
  if (!parsed.success) fail('invalid_calendar_reschedule');
  const value = parsed.data, ref = value.source;
  if (ref.kind === 'showing') {
    const current = getSampleShowing(ref.sourceId);
    updateSampleShowing(ref.sourceId, { requestId: value.requestId, expectedUpdatedAt: ref.expectedUpdatedAt, action: 'reschedule', startsAt: value.startsAt, endsAt: value.endsAt, meetingDetails: current.meetingDetails, notes: current.notes });
  } else if (ref.kind === 'next_action') {
    const current = readSampleContact(ref.sourceId);
    if (!canRead(current) || current.nextAction?.assigneeId !== SAMPLE_ACTOR.userId) fail('not_found', 404);
    const action = current.nextAction;
    await updateNextAction(ref.sourceId, { action: 'set', expectedUpdatedAt: ref.expectedUpdatedAt, expectedActionId: ref.actionId, next: { kind: action.kind, purpose: action.purpose, dueAt: value.startsAt, assigneeId: action.assigneeId } });
  } else {
    const deadline = readPreviewTransactionExtra(ref.sourceId, bundle => bundle.deadlines.find(d => d.id === ref.deadlineId));
    if (!deadline) fail('not_found', 404);
    if ((deadline.completedAt || deadline.removedAt) && !hasPreviewDeadlineEditReceipt(ref.sourceId, ref.deadlineId, value.requestId)) fail('invalid_transition', 409);
    await mutatePreviewTransactionDeadline(ref.sourceId, { requestId: value.requestId, expectedUpdatedAt: ref.expectedUpdatedAt, deadlineId: ref.deadlineId, expectedDeadlineUpdatedAt: ref.expectedDeadlineUpdatedAt, action: 'edit', deadline: { kind: deadline.kind, label: deadline.label, dueDate: value.dueDate, note: deadline.note } });
  }
  return { rescheduled: true };
}
