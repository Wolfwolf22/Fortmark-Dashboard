# Leads V2 — the daily CRM workspace

Status: **complete and certified in Preview.** Not promoted. No schema change, no
migration, no environment change. MLS, auth, AI, Opportunities and Transactions
are untouched.

Leads remain Contacts. Transactions remain executable deals. Opportunities remain
frozen. Nothing here scores, forecasts, values or recommends.

No real client data is in this document; certification used synthetic contacts.

## 1. Repository truth (audited first)

| Question | Answer |
|---|---|
| Lifecycle | `lead → contacted → qualified → appointment → representation → active_client → under_contract → closed → past_client`, exits `lost` and `archived` (`lib/contacts/stages.ts`). The Postgres enum is declared in the same order. |
| "Active" | The open pipeline: `lead` through `under_contract`. The same set Home's Needs-attention uses for follow-up duty. |
| Owner | `contacts.assigned_agent_user_id` is **NOT NULL** and references a dashboard user. Every contact has an owner. |
| Source | Stored (`contact_source` enum, ten values). |
| Intent | **Not stored on the contact.** It is summarised from the person's open needs (`contact_opportunities`) by `toIntent`; a contact with no open need reads `other`. |
| Last touch | `last_contact_at`, stamped only by a logged touch. Null means never touched. |
| Follow-up | `next_follow_up_at`, noon UTC of the picked day, judged on the America/New_York business day. |
| History | `contact_activities` holds interactions and stage moves. A reminder change is **not** an activity (certified). |
| Authorization | `visibleTo` (SQL) and `canSee`/`canWrite` (rows): privileged roles (admin, broker, transaction coordinator) see and write the brokerage; an agent only their own; a member reads but never writes. |
| Before V2 | The list returned up to 500 rows and filtered/sorted/paged in the browser; the search text was stripped of `%`/`_` (M-02); an unknown `stage=` was ignored (M-04). |

Fields the brief asked for that the domain cannot support, and what was done:

- **Unassigned** (card and view): impossible — every contact has an owner. Omitted,
  not faked. Supporting it would need a nullable owner: a schema change, which is
  outside this phase.
- **Editable intent**: intent is a summary of Opportunities, which are frozen. Shown
  read-only ("Not stated" when there is no open need); never edited from Leads.

## 2. What was built

### The page (`/leads`)
- Title and one line: *Manage relationships, follow-ups and activity.* The section's
  one `h1` is still the shell's hidden heading; the visible title is presentational.
- **Snapshot** — Active · New (7 days) · Due today · Overdue · No touch 14+ days.
  Counts come from one aggregate over the contacts the caller may list, using the
  same predicates the table applies, so a card equals the rows it opens. Each card
  is a button that applies exactly its filters. If counts cannot be had the strip
  says so; it never shows a zero it did not measure.
- **Quick views** — All leads · My leads · Due today · Overdue · No touch 14+ days.
  Presets over one query, not datasets. For a role that only ever sees its own
  contacts, "All" and "Mine" are the same list, so one view is shown, named *My
  leads*. The follow-up and no-touch views are scoped to the open pipeline.
- **Filters** — stage, source, intent, agent (privileged, from the roster),
  follow-up (overdue / due today / upcoming / none), last touch (today / 7+ / 14+ /
  30+ / never), date added (today / 7 / 30 days), and search. They compose.
- **Table** — Name, Intent, Stage, Source, Assigned agent, Last touch, Next
  follow-up, Created, Actions. Sortable headers announce `aria-sort`; the header is
  sticky inside a bounded scroll area; 25 rows a page with Previous/Next and a
  count. Loading, error (with *Try again*) and empty states. No sample people, no
  fake figures. "Intent" shows an em dash where none is stated; a person never
  touched reads "Never"; an unnamed agent reads "Unnamed agent" with no avatar
  initials.
- **URL state** — filters, sort and page live in the URL (`/leads?followUp=overdue&active=1`),
  push history entries, survive a reload and back/forward, and an invalid value in a
  pasted URL is dropped, not fatal. **Search text never goes in the URL** (it is a
  client's name, number or email, and a URL is logged); it is sent in a POST body.
- **Mobile (<768 px)** — a compact list: name, stage, next follow-up, last touch and
  (brokerage-wide roles) the agent; one tap opens the drawer, which holds every
  action. Filters sit behind a *Filters* disclosure. No horizontal page overflow at
  430 or 390.
- **New lead** — the existing quick-create, now with an optional Source, and it
  lands on the new person's drawer, ready for a first follow-up.

### The drawer (the workspace for one relationship)
Sections, in working order: **Contact** (details and *Edit contact*) →
**Relationship** (assigned agent, last touch, *Reassign agent*, stage, *Archive* /
*Restore to Lead*) → **Next follow-up** → **Log a touch** → **Activity** →
**Notes**. Controls a role cannot use are not offered (a member sees *You have
read-only access to this contact.*); the server still decides.

- **Edit contact** — first, last and preferred name, email, phone, company, source,
  notes. Only what changed is sent; email is lower-cased; a phone is stored E.164 or
  refused (`invalid_phone`), never half-stored (create now normalises the same way);
  a contact must keep a name. Ownership, stage, dates, identifiers and brokerage are
  not editable: a body naming one is a 400, not ignored. Errors name fields, never
  values; focus moves to the first invalid field once the form is enabled again.
- **Reassign agent** — admin, broker, transaction coordinator. The new owner must be
  a real, active dashboard user in a work-owning role (the roster the agent filter
  uses); an MLS listing agent, a member, a suspended or missing user cannot be named.
  An agent may not hand their own contact away (403).
- **Archive** asks first; **Restore to Lead** is one click. Both are the existing
  certified stage writer.
- **Follow-up and touch** are unchanged in behaviour (see `CRM_FOLLOW_UP.md`).

### Activity timeline
Loaded when the drawer opens (one request), newest first, in the CRM's words:
*Called client · Emailed client · Texted client · Met with client · Showing · Added
note · Stage changed to Qualified · Follow-up scheduled for Oct 3, 2026 · Follow-up
moved to … · Follow-up completed · Assigned to <name> · Contact added.* Only a
headline, optional detail, a time and (when known) a name leave the server — no
audit record, no metadata, no actor id.

Sources: activities for interactions, stage moves and reassignments; the **audit
trail** for direct follow-up changes, because a reminder is deliberately not an
activity (writing one would put a phantom interaction in the history and was
explicitly ruled out). A touch that also moved the reminder carries the outcome on
its own activity row, so it shows as a second line.

## 3. Server behaviour

| | |
|---|---|
| **M-02 fixed** | Search text is a literal. `%`, `_` and `\` are escaped (`escapeLike`) and bound as parameters; `q=%` finds only what contains a percent sign. The predicate is added to visibility, never in place of it. |
| **M-04 fixed** | Every filter is validated. An unknown stage, source, intent, follow-up, last-touch, created, sort, direction, page or size is a **400** naming the parameter (never the value). `stage=lead,garbage` is refused whole. An empty value is "not given". |
| Filtering | In SQL: stage, active, source, intent (the SQL twin of `toIntent`), agent, mine, follow-up, last touch, created, search. Sort keys: name, stage, last touch, follow-up (none last both ways), created; ties fall back to newest-first then id so a page boundary never repeats or drops a row. Paging returns `total` (the match count). |
| Windows | One `now` and one module (`windows.ts`) define every boundary; SQL and the in-memory evaluator use the same values. Follow-up: business day (DST-safe). Last touch and created: elapsed time, *more than* N days; a person never touched ages from when they were added. |
| Last-touch integrity | "No touch 14+" reads `last_contact_at` (or creation) and nothing else. Scheduling a reminder, completing one, editing or reassigning cannot make a stale contact look recent (asserted in SQL text, offline and live). |
| Compatibility | `GET /api/contacts` and `POST /api/contacts/search` still return `{items}` when not paged; `total` is added. |
| New routes | `PATCH /api/contacts/[id]`, `POST /api/contacts/[id]/reassign`, `GET /api/contacts/[id]/timeline`, `GET /api/contacts/summary`. All authenticate first, are `private, no-store`, and answer an out-of-scope id exactly like a missing one. |
| Atomicity | Edit = update + audit; reassign = update + history line + audit; each in one `db.batch`. A request that changes nothing writes nothing. |
| Audit | Field **names** (`fields: ["email","phone"]`), mechanism (`edit`, `reassign`, `direct`), outcome. Never a value, name, email, phone or note. Direct follow-up events now also carry the reminder's day (workflow data) so the timeline can name it; this replaces the earlier "never the date" rule for that one field. |
| Reads retry once | The browser adapter retries a **read** once when the connection drops or a gateway says 502/504. A write is never retried. |

## 4. Authorization (certified live, per role)

| | admin / broker / coordinator | agent | member |
|---|---|---|---|
| List / snapshot / timeline | whole brokerage (42 in the fixture) | own (40) | own (40) |
| Colleague's contact by id | visible | 404 | 404 |
| Another brokerage's | 404 | 404 | 404 |
| Edit / follow-up / touch / stage / archive | yes | own only | **403** |
| Reassign | yes | **403** (own), 404 (colleague's) | **403** |
| New lead | yes | yes | not offered |
| Agent filter | roster | not offered | not offered |

## 5. Tests

- **Offline** — `npm run test:leads` (new): **277 checks** — the strict parser, the
  views, the evaluator against the certified classifier across midnights and both
  DST days (~10k decisions), sorting/paging partitions, the SQL rendered with
  drizzle's dialect (visibility in every query; literal escaped search; hostile text
  only ever a parameter; the no-touch window reads nothing else), the real
  `editContact` / `reassignContact` / `getTimeline` against a transactional
  in-memory database with each write forced to fail, every refusal paired with the
  same request succeeding, and structural checks on the routes and screen. Full
  `npm test` (19 suites), `test:migrate` (23), typecheck and build are green.
- **Live, Preview** — `e2e/leads-v2.spec.ts`, one role per run:
  admin **20/20**, broker **20/20**, transaction coordinator **20/20**, agent
  **20/20**, member **19 passed, 1 skipped** (a member cannot create). Desktop 1440
  and 1280, mobile 430 and 390, keyboard, reduced motion.
- **Regression, Preview** — follow-up workflow (agent 18/18, member, broker),
  agent workday (11/11, "AGENT WORKDAY: YES"), zero-data sweep and API smoke
  (10/10). Older specs were updated only for two deliberate changes: the search
  placeholder ("phone or area") and the member drawer (read-only instead of
  offering controls that could only answer 403).

## 6. Performance

Page load: **1** list request, **1** summary, **1** agents, **1** source probe (plus
the shell's own) — no duplicate and nothing per row. Drawer: contact + timeline (+ the
roster for a privileged role, only while a drawer is open). List queries return only
what the table draws; assigned-agent names are resolved in one batch per page; the
timeline is loaded on demand. No N+1 anywhere.

## 7. Known limitations

- **Pipeline board / drag-and-drop: deferred.** A truthful board needs per-stage
  server counts and per-column paging; that deserves its own certification. Stage
  navigation is covered by the stage filter (with counts), the snapshot and the
  drawer's stage control, all through the certified stage writer.
- **No Unassigned** (owner is required by the schema) and **no editable intent**
  (Opportunities are frozen).
- **No bulk actions** (optional in the brief; deliberately not started).
- Timeline follow-up events read `audit_events` filtered by contact id (there is no
  index on that JSON key). Fine at brokerage scale; an expression index would be the
  remedy and needs a migration, so it is only proposed here.
- Older follow-up events written before this release have no day, so the timeline
  says "Follow-up scheduled" without one.
- Sorting by assigned agent is not offered (it would need a join to profiles).
- A follow-up's audit event and a touch's activity are separate sources, so a
  direct change and a touch on the same instant can order arbitrarily.
- Transaction deadlines, metric windows and the AI follow-up validator still use UTC
  days (M-12). Not touched.
- Preview only. Platform intermittency (a static chunk occasionally dropped or a 502
  on it, behind the portal rewrite) was seen in about a quarter of UI runs; the asset
  was verified served each time. It is counted, never hidden, and the harness reloads
  once when it happens.
