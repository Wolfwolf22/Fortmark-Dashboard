// Private synthetic personal work. Deliberate writes stay in this module's ephemeral memory.
import { DEFAULT_CALENDAR_LABELS } from '../../lib/calendar/personal-domain.ts';
import { personalCalendarMutationSchema, calendarLabelMutationSchema, calendarAnnotationMutationSchema } from '../../lib/calendar/personal-validation.ts';
import { canonicalTourFingerprint } from '../../lib/showings/tour-domain.ts';
import { SAMPLE_ACTOR, interactiveSamples } from './sample-session.mjs';
import { sortCalendarItems } from '../../lib/calendar/scheduling.ts';

const records = new Map(), overrides = new Map(), annotations = new Map(), receipts = new Map();
const copy = value => structuredClone(value);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const owner = () => `${SAMPLE_ACTOR.brokerageKey}:${SAMPLE_ACTOR.userId}`;
const annotationKey = item => `${owner()}:${JSON.stringify([item.kind, item.sourceId, item.id])}`;
const stamp = current => new Date(Math.max(Date.now(), Date.parse(current || '1970-01-01') + 1)).toISOString();
const writable = () => { if (!interactiveSamples()) fail('preview_read_only', 403); if (SAMPLE_ACTOR.role === 'member') fail('forbidden', 403); };
const parsed = (schema, input, code) => { const result = schema.safeParse(input); if (!result.success) fail(code); return result.data; };
const revision = (actual, expected) => { if ((actual ?? null) !== (expected ?? null) && Date.parse(actual) !== Date.parse(expected)) fail('conflict', 409); };
const labelFor = id => id === null ? null : overrides.get(`${owner()}:${id}`) || DEFAULT_CALENDAR_LABELS.find(label => label.id === id) || null;
const projectLabel = label => label ? copy(label) : null;
function selectedLabel(id, expected, retainedId) { const label = labelFor(id); if (id !== null && !label) fail('not_found', 404); revision(label?.updatedAt, expected); if (label?.archivedAt && id !== retainedId) fail('label_archived', 409); return label; }
function materializeLabel(label, updatedAt) { if(label && label.updatedAt===null)overrides.set(`${owner()}:${label.id}`,{...label,updatedAt}); }
function recordFor(id) { const record = records.get(id); if (!record || record.owner !== owner()) fail('not_found', 404); return record; }
function recordView(record) { return { id: record.id, details: copy(record.details), label: projectLabel(labelFor(record.details.labelId)), createdAt: record.createdAt, updatedAt: record.updatedAt, cancelledAt: record.cancelledAt, canEdit: SAMPLE_ACTOR.role !== 'member' && !record.cancelledAt }; }
let chain = Promise.resolve();
function write(resource, input, work, replay) {
  writable(); const actor = owner(), role = SAMPLE_ACTOR.role;
  const run = chain.then(() => {
    writable(); if (owner() !== actor || SAMPLE_ACTOR.role !== role) fail('forbidden', 403);
    const key = `${actor}:${input.requestId}`, fingerprint = canonicalTourFingerprint({ resource, input }), prior = receipts.get(key);
    if (prior) { if (prior.fingerprint !== fingerprint) fail('request_conflict', 409); return replay(prior.result); }
    const result = work(); receipts.set(key, { fingerprint, result: result.receipt }); return result.value;
  });
  chain = run.catch(() => {}); return run;
}
export function getPreviewCalendarLabels() {
  const ids = new Set(DEFAULT_CALENDAR_LABELS.map(label => label.id));
  for (const key of overrides.keys()) if (key.startsWith(`${owner()}:`)) ids.add(key.slice(owner().length + 1));
  return { labels: [...ids].map(labelFor).filter(label => label && !label.archivedAt).map(copy) };
}
export function mutatePreviewCalendarLabel(input) {
  const value = parsed(calendarLabelMutationSchema, input, 'invalid_calendar_label');
  return write('label', value, () => {
    const current = value.action === 'create' ? null : labelFor(value.id);
    if (value.action !== 'create' && !current) fail('not_found', 404);
    if (current) { if (current.archivedAt) fail('label_archived', 409); revision(current.updatedAt, value.expectedUpdatedAt); }
    if (value.action === 'create' && getPreviewCalendarLabels().labels.length >= 54) fail('label_limit', 409);
    const next = stamp(current?.updatedAt), label = value.action === 'create'
      ? { id: crypto.randomUUID(), ...value.details, updatedAt: next, archivedAt: null, isDefault: false }
      : { ...current, ...(value.action === 'update' ? value.details : {}), updatedAt: next, archivedAt: value.action === 'archive' ? next : null };
    overrides.set(`${owner()}:${label.id}`, label); return { value: copy(label), receipt: label.id };
  }, id => { const label = labelFor(id); if (!label) fail('not_found', 404); return copy(label); });
}
export function getPreviewPersonalCalendarRecord(id) { return recordView(recordFor(id)); }
export function mutatePreviewPersonalCalendar(input) {
  const value = parsed(personalCalendarMutationSchema, input, 'invalid_personal_calendar');
  return write('personal', value, () => {
    const current = value.action === 'create' ? null : recordFor(value.id);
    if (current) { revision(current.updatedAt, value.expectedUpdatedAt); if (current.cancelledAt) fail('invalid_transition', 409); }
    const label = value.action !== 'cancel' ? selectedLabel(value.details.labelId, value.expectedLabelUpdatedAt, current?.details.labelId) : null;
    const next = stamp(current?.updatedAt), record = value.action === 'create'
      ? { id: crypto.randomUUID(), owner: owner(), details: copy(value.details), createdAt: next, updatedAt: next, cancelledAt: null }
      : { ...current, ...(value.action === 'update' ? { details: copy(value.details) } : {}), updatedAt: next, cancelledAt: value.action === 'cancel' ? next : null };
    materializeLabel(label,next); records.set(record.id, record); return { value: recordView(record), receipt: record.id };
  }, id => getPreviewPersonalCalendarRecord(id));
}
export function previewPersonalCalendarItems(query, window) {
  if (!interactiveSamples()) return [];
  return sortCalendarItems([...records.values()].filter(record => record.owner === owner() && !record.cancelledAt).filter(record => record.details.allDay
    ? record.details.day >= query.fromDay && record.details.day < query.toDay
    : Date.parse(record.details.startsAt) < Date.parse(window.to) && Date.parse(record.details.endsAt) > Date.parse(window.from)).map(record => {
    const details = record.details;
    return { id: `personal:${record.id}`, kind: 'personal', title: details.title, subtitle: details.location, day: details.day, allDay: details.allDay, startsAt: details.startsAt, endsAt: details.endsAt, blocksTime: !details.allDay && details.blocksTime, status: 'scheduled', sourceId: record.id, sourceHref: `/calendar?item=${record.id}`, sourceLabel: 'My calendar item', reschedule: null, personal: { updatedAt: record.updatedAt, canEdit: SAMPLE_ACTOR.role !== 'member' }, annotation: { labelId: details.labelId, updatedAt: record.updatedAt }, label: projectLabel(labelFor(details.labelId)) };
  }));
}
export function decoratePreviewCalendarItems(items) {
  return items.map(item => {
    if (item.kind === 'personal') return item;
    const annotation = interactiveSamples() ? annotations.get(annotationKey(item)) : null;
    return { ...item, annotation: { labelId: annotation?.labelId ?? null, updatedAt: annotation?.updatedAt ?? null }, label: projectLabel(labelFor(annotation?.labelId ?? null)) };
  });
}
export function mutatePreviewCalendarAnnotation(input, resolveSource) {
  const value = parsed(calendarAnnotationMutationSchema, input, 'invalid_calendar_annotation');
  const target = (allowCancelled=false) => {
    if (value.item.kind === 'personal') { const record = recordFor(value.item.sourceId); if (value.item.id !== `personal:${record.id}`) fail('not_found', 404); if(record.cancelledAt&&!allowCancelled)fail('invalid_transition',409);return record; }
    resolveSource(value.item); return null;
  };
  const result = () => {
    const record = target(true), annotation = record ? { labelId: record.details.labelId, updatedAt: record.updatedAt } : annotations.get(annotationKey(value.item));
    if (!annotation) fail('not_found', 404); return { annotation: copy(annotation), label: projectLabel(labelFor(annotation.labelId)) };
  };
  return write('annotation', value, () => {
    const record = target(), key = annotationKey(value.item), current = record ? { labelId: record.details.labelId, updatedAt: record.updatedAt } : annotations.get(key);
    revision(current?.updatedAt, value.expectedUpdatedAt); const label=selectedLabel(value.labelId, value.expectedLabelUpdatedAt, current?.labelId);
    const updatedAt = stamp(current?.updatedAt);
    materializeLabel(label,updatedAt);
    if (record) { const next = { ...record, details: { ...record.details, labelId: value.labelId }, updatedAt }; records.set(record.id, next); }
    else annotations.set(key, { labelId: value.labelId, updatedAt });
    return { value: result(), receipt: value.item.id };
  }, () => result());
}
