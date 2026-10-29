/** Full history against isolated PostgreSQL, including microsecond/time ties. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { dashboardUsers } from "../lib/db/schema.ts";
import { getTimeline, type Ctx } from "../lib/contacts/service.ts";
import { getTimelinePage } from "../lib/contacts/history-service.ts";
import { listNotesPage } from "../lib/contacts/notes-service.ts";
import { decodeHistoryCursor, encodeHistoryCursor, readHistoryQuery } from "../lib/contacts/history.ts";
import { toTimeline } from "../lib/contacts/timeline.ts";

const { pg, db } = await createLocalContactDb();
const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: "22222222-2222-4222-8222-222222222222" };
const ctx: Ctx = { actor, db };
let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }

try {
  await db.insert(dashboardUsers).values([
    { id: actor.userId, clerkUserId: "local_history_owner", primaryEmail: "owner@example.test", status: "active", role: "agent" },
    { id: other.userId, clerkUserId: "local_history_other", primaryEmail: "other@example.test", status: "active", role: "agent" },
  ]);
  const id = randomUUID();
  await pg.query("insert into contacts(id,assigned_agent_user_id,first_name) values($1,$2,'Synthetic history')", [id, actor.userId]);
  await pg.query(`insert into contact_notes(id,contact_id,author_user_id,body,created_at)
    select gen_random_uuid(),$1::uuid,$2::uuid,'Synthetic note '||n,
      '2026-10-29T15:00:00.123Z'::timestamptz + ((n%4)::text||' microseconds')::interval
    from generate_series(1,131) n`, [id, actor.userId]);
  await pg.query("update contact_notes set body=null,deleted_at=now(),deleted_by_user_id=$2 where contact_id=$1 and body in ('Synthetic note 130','Synthetic note 131')", [id, actor.userId]);
  const expectedNotes = (await pg.query<{ id: string }>("select id from contact_notes where contact_id=$1 and deleted_at is null order by date_trunc('milliseconds',created_at) desc,id::text desc", [id])).rows.map(row => row.id);
  const notes: string[] = [];
  let noteCursor: string | null = null;
  let firstNoteCursor: string | null = null;
  for (let index = 0; index < 10; index++) {
    const result = await listNotesPage(ctx, id, { pageSize: 25, cursor: noteCursor ? decodeHistoryCursor(noteCursor)! : undefined });
    check("notes page is authorized", result.ok);
    check("notes page is bounded", result.value.items.length <= 25);
    check("cursor truthfully indicates older notes", result.value.hasMore === Boolean(result.value.nextCursor));
    check("deleted note bodies never reach the reader", result.value.items.every(note => note.body !== null && !/Synthetic note 13[01]$/.test(note.body)));
    notes.push(...result.value.items.map(note => note.id));
    noteCursor = result.value.nextCursor;
    if (index === 0) firstNoteCursor = noteCursor;
    if (!noteCursor) break;
  }
  check("all129 live notes are reachable beyond old100 cap", notes.length === 129);
  check("tied microsecond timestamps never duplicate or omit a note", new Set(notes).size === 129 && notes.join() === expectedNotes.join());
  const outsider = await listNotesPage({ actor: other, db }, id, { cursor: decodeHistoryCursor(firstNoteCursor!)! });
  check("a known older-note cursor cannot bypass contact ownership", !outsider.ok && outsider.reason === "not_found");
  const reader = await listNotesPage({ actor: { ...actor, role: "member" }, db }, id);
  check("authorized read-only readers can load notes but cannot delete", reader.ok && reader.value.items.every(note => !note.canDelete));

  // Cursor values stand alone: deleting the boundary row does not strand older records.
  const boundary = decodeHistoryCursor(firstNoteCursor!)!;
  await pg.query("update contact_notes set body=null,deleted_at=now() where id=$1", [boundary.id]);
  const afterDeletion = await listNotesPage(ctx, id, { cursor: boundary });
  check("deleting a cursor's source row does not break older paging", afterDeletion.ok && afterDeletion.value.items.length === 25 && !afterDeletion.value.items.some(note => note.id === boundary.id));
  const newNote = randomUUID();
  await pg.query("insert into contact_notes(id,contact_id,author_user_id,body,created_at) values($1,$2,$3,'New note','2026-10-29T16:00:00Z')", [newNote, id, actor.userId]);
  const afterInsert = await listNotesPage(ctx, id, { cursor: boundary });
  check("newer insert does not repeat during older paging", afterInsert.ok && !afterInsert.value.items.some(note => note.id === newNote));
  const refreshed = await listNotesPage(ctx, id);
  check("refresh reveals the newly added note", refreshed.ok && refreshed.value.items[0].id === newNote);

  await pg.query(`insert into contact_activities(id,contact_id,actor_user_id,kind,summary,occurred_at,safe_metadata)
    select gen_random_uuid(),$1::uuid,$2::uuid,'call','Synthetic call '||n,
      '2026-10-29T15:00:00.123Z'::timestamptz + ((n%4)::text||' microseconds')::interval,
      case when n%20=0 then '{"followUp":"scheduled","followUpDay":"2026-10-30"}'::jsonb else null end
    from generate_series(1,120) n`, [id, actor.userId]);
  await pg.query(`insert into audit_events(event_type,actor_user_id,safe_metadata,created_at)
    select 'contact_note_created',$2::uuid,jsonb_build_object('contactId',$1::text,'noteId',gen_random_uuid()),
      '2026-10-29T15:00:00.123Z'::timestamptz + ((n%4)::text||' microseconds')::interval
    from generate_series(1,35) n`, [id, actor.userId]);
  await pg.query(`insert into audit_events(event_type,actor_user_id,safe_metadata,created_at)
    select 'contact_updated',$2::uuid,jsonb_build_object('contactId',$1::text,'field','nextFollowUpAt','followUp','completed'),
      '2026-10-29T15:00:00.123Z'::timestamptz + ((n%4)::text||' microseconds')::interval
    from generate_series(1,20) n`, [id, actor.userId]);
  // Irrelevant old audit rows must not consume a page of renderable events.
  await pg.query(`insert into audit_events(event_type,actor_user_id,safe_metadata,created_at)
    select 'contact_updated',$2::uuid,jsonb_build_object('contactId',$1::text,'field','nextFollowUpAt','followUp','kept'),
      '2026-10-29T17:00:00Z' from generate_series(1,40) n`, [id, actor.userId]);
  const expected = await getTimeline(ctx, id, 200);
  check("fixture contains181 distinct timeline entries", expected.ok && expected.value.length === 181);
  const seen: string[] = [];
  let timelineCursor: string | null = null;
  for (let index = 0; index < 12; index++) {
    const result = await getTimelinePage(ctx, id, { pageSize: 25, cursor: timelineCursor ? decodeHistoryCursor(timelineCursor)! : undefined });
    check("timeline page is authorized", result.ok);
    check("timeline page is bounded", result.value.items.length <= 25);
    check("timeline cursor indicates older entries", result.value.hasMore === Boolean(result.value.nextCursor));
    check("timeline does not expose actor identifiers or metadata", result.value.items.every(item => !JSON.stringify(item).includes(actor.userId) && !JSON.stringify(item).includes("safeMetadata")));
    seen.push(...result.value.items.map(item => item.id));
    timelineCursor = result.value.nextCursor;
    if (!timelineCursor) break;
  }
  check("all181 entries remain reachable beyond100 cap", seen.length === 181 && new Set(seen).size === 181);
  check("mixed source and timestamp ties preserve complete deterministic order", seen.join() === expected.value.map(item => item.id).join());
  const paired = expected.value.findIndex(item => item.id.endsWith(":follow-up"));
  const pairedCursor = { at: expected.value[paired].at, id: expected.value[paired].id };
  const sibling = await getTimelinePage(ctx, id, { pageSize: 1, cursor: pairedCursor });
  check("a page ending on a derived reminder still reaches its interaction", sibling.ok && sibling.value.items[0]?.id === expected.value[paired + 1].id);
  const privateTimeline = await getTimelinePage({ actor: other, db }, id, { cursor: pairedCursor });
  check("older activity is scoped like its contact", !privateTimeline.ok && privateTimeline.reason === "not_found");

  const roundTrip = { at: "2026-10-29T15:00:00.123Z", id: `${randomUUID()}:follow-up` };
  check("cursor roundtrip preserves derived event keys", JSON.stringify(decodeHistoryCursor(encodeHistoryCursor(roundTrip))) === JSON.stringify(roundTrip));
  for (const value of ["", "not-json", "!", "a".repeat(257)]) check("malformed cursor is rejected", decodeHistoryCursor(value) === null);
  for (const query of ["pageSize=0", "pageSize=101", "pageSize=no", "cursor="]) check("invalid paging request is rejected", readHistoryQuery(new URLSearchParams(query)) === null);
  const marked = toTimeline({ activities: [{ id: "legacy", kind: "note", summary: "Marked contacted", occurredAt: new Date(), actorUserId: null, safeMetadata: null }], followUpEvents: [], names: new Map() });
  check("legacy quick mark accurately identifies contact, not a note", marked[0].type === "contacted" && marked[0].title === "Marked contacted" && !marked[0].detail);
  const internal = toTimeline({ activities: [{ id: "internal", kind: "note", summary: "Private internal note", occurredAt: new Date(), actorUserId: null, safeMetadata: null }], followUpEvents: [], names: new Map() });
  check("internal note is distinguished from a Notes-composer event", internal[0].title === "Internal note recorded" && internal[0].detail === "Private internal note");
  console.log(`${passed}/${passed} contact history checks passed`);
} finally { await pg.close(); }
