# Leads V2 — Production promotion audit

**Audit only.** Nothing was deployed or merged. Production (database, environment,
deployment, branch) was only read.

No secrets and no client data are in this document. Production data is described by
counts and shapes only.

## Decision

**GO FOR LEADS V2 PRODUCTION PROMOTION** — subject to human authorization and the
operator's own signed-in smoke (§14). No P0, no P1.

## 1. Baseline

| | |
|---|---|
| Certified revision | `74ff9d4` on `claude/dashboard-status-yir55p` (nine commits ahead of Production, none behind: a fast-forward) |
| Production / default | `claude/fortmark-dashboard-build-v39u96` at `01f7f94` |
| Production deployment | `dpl_JE8Sch3v753t68tyEbNJqB7ckJ2L`, READY, target production |
| Production health | `revision=01f7f94`, `contacts=db`, `transactions=db`, `listings=mls`, `homeMetrics=real-only`, assistant `no_credential`, `actions=disabled` |
| Preview | serves `74ff9d4` (`listings=not_configured` there, as before) |
| Working tree | clean |
| Production data (counts) | 1 contact · 6 activities · 1 opportunity · **1 transaction** · 1 user · 1 profile · 1 brokerage · 1 MLS link · 0 prepared actions · 11 migrations · 178 audit events |

**Drift since the last audit:** Production now holds **one transaction** (there were
none). The revision, sources and migration level are unchanged, so this is operator
use of the live system, not a deployment drift. Leads V2 does not touch
transactions (§9).

Any later commit on the dev branch is documentation only; the promotable runtime is
`74ff9d4` (compare tree hashes of `app`, `components`, `lib`, `public`, `scripts`
and `package.json` at promotion time).

## 2. Runtime delta (`01f7f94` → `74ff9d4`)

38 files, all Leads/Contacts:

| Area | Files |
|---|---|
| Leads page | `app/(app)/leads/page.tsx`, `components/leads/{leads-table,leads-filters,leads-snapshot,lead-shared}`, `pipeline-summary` **deleted** (unused) |
| Contact drawer / editing | `components/leads/{lead-drawer,lead-edit-form}` |
| Timeline | `components/leads/lead-timeline`, `lib/contacts/timeline.ts`, `app/api/contacts/[id]/timeline/route.ts` |
| Query, filters, search | `lib/contacts/{filters,list-sql,windows,visibility}.ts`, `app/api/contacts/{route,search/route,summary/route}.ts` |
| Edit / reassign | `lib/contacts/{domain,service,http}.ts`, `app/api/contacts/[id]/{route,reassign/route}.ts` |
| Follow-up integration | `lib/contacts/service.ts` (audit carries the day; touch row carries the outcome) |
| Client adapter, types | `lib/data/adapters/leads.ts`, `lib/data/sample-leads.ts`, `lib/data/types.ts` |
| Create-lead flow | `components/layout/quick-create-dialog.tsx` (lead branch only: optional Source, opens the new person) |
| Shared UI | `components/ui/table.tsx` — one new **optional** prop (`containerClassName`); without it the output is identical, so the ten other tables are unchanged |
| Tests / docs / config | `scripts/test_*`, `e2e/*`, `docs/*`, `package.json` (two script entries; **no dependency change**) |

Nothing changed under `lib/db`, `lib/mls*`, `lib/ai`, `lib/auth`, `lib/search`,
`lib/transactions`, `lib/metrics`, `lib/brokerage`, `lib/team`, `lib/profile`,
`lib/flags.ts`, `middleware.ts`, `next.config.ts`, `vercel.json`,
`package-lock.json`, `app/api/{listings,ai,chat,transactions,metrics,team,brokerage,profile,search}`,
`components/home`, `components/listings`, the app shell or the top bar. **No
unrelated runtime change.**

## 3. Database

**No migration.** No file under `lib/db/`; no SQL, schema, journal or snapshot
change; no new column, no index, no backfill, no data transformation.

Preview and Production have **identical schemas** (hash over 208 columns and over all
indexes matches), so the SQL certified against Preview's Neon branch runs against
Production's.

## 4. Compatibility with Production's real contact (shapes only)

The one contact: stage `lead`, source `other`; email and phone present; company and
preferred name null; notes empty; a recorded last touch; **no follow-up**; owner an
active admin; one open need; six activities (one note with no metadata, four stage
changes with `from`/`to`, one system row with `source`).

Run against those shapes: it lists, sorts and filters; the timeline renders it
(*Contact added, Added note, four "Stage changed to …" lines*); intent reads from its
open need; "Never touched" does not apply (it has a touch); the follow-up filters
classify "none". No field in the new code requires a value the row lacks.

## 5. Phone normalization — special audit

Helper: `toE164` (`lib/profile/normalize.ts`, the same one the profile and brokerage
domains use). Behaviour, run on the matrix:

| Input | Result |
|---|---|
| `9545550100`, `(954) 555-0100`, `954-555-0100`, `954.555.0100`, `1-954-555-0100`, `19545550100`, `+1 954 555 0100` | `+19545550100` |
| `+442079460958`, `+44 20 7946 0958` | kept as E.164 (international needs a leading `+`) |
| `0044 20 …`, `555-0100` (7 digits), `954 555 01`, extensions (`x22`, `ext 5`), letters, blank, > 15 digits | **unreadable** → `null` |

- **Create** (`createContact`): a readable number is stored E.164; an **unreadable one
  is kept as typed** (`toE164(x) ?? x`), a blank is null. Create never refuses a phone.
  *This corrects an earlier statement that create refuses.* It is exactly what create
  has always accepted, plus normalisation. The only create caller is
  `POST /api/contacts` (quick-create form, free text).
- **Edit** (`planContactEdit`): a phone that is **sent** must be readable or the edit
  is a 400 `invalid_phone` (field named, value not echoed); blank clears.
- **Existing rows are never touched or made unreadable.** Production's contact stores
  its phone as **10 raw digits without `+`** (the legacy format, from before
  normalisation). It renders exactly as stored; phone search matches it by suffix;
  editing anything else (the form sends only changed fields) never sends or validates
  the phone. Re-entering that same number upgrades it to E.164 and is recorded as a
  `phone` change — benign.
- Refused-on-edit shapes an agent might legitimately want (an extension, a
  `00`-prefixed international number, a 7-digit local number) are a **P3** usability
  gap, not a safety one.

## 6. Editing, reassignment, scope

| Check | Result |
|---|---|
| Editable fields | first / last / preferred name, email, phone, company, source, notes — nothing else |
| Unknown or protected fields (`assignedAgentUserId`, `brokerageKey`, `stage`, `lastContactAt`, `nextFollowUpAt`, `id`, `createdAt`, `role`, tags, opportunities) | schema is `.strict()` → 400 naming `body`, not ignored |
| Authorization before content | out of scope 404 → read-only 403 → then name/phone validity (asserted in the offline suite and live) |
| Errors | field names only; values are never echoed |
| Audit of an edit | `{contactId, mechanism:"edit", fields:[names]}` — no values |
| Reassign — who | admin, broker, transaction coordinator. An agent (even for their own contact) and a member: **403**; a colleague's or foreign contact: **404** |
| Reassign — target | must be a real, active dashboard user in a work-owning role (`canOwnRecords`): an MLS agent id, a member, a suspended, pending or missing user → 400 `invalid_assignee`; the roster the UI offers is the same set |
| Atomicity | edit = update + audit; reassign = update + history line + audit; each one `db.batch` (a Neon transaction). Forced failure of each write in turn leaves nothing behind |
| Brokerage | there is a single brokerage and **no user-to-brokerage membership**, so "same brokerage" for an assignee is the same as everywhere else in the product: any active work-owning dashboard user (**P3**, pre-existing) |

Live, Preview, every role: admin, broker, coordinator, agent 20/20; member 19 (+1 skipped).
A member sees a read-only note and no write control.

## 7. Filters, M-02, M-04, snapshot, views

- **Server-driven, validated, scoped, bounded.** Stage, active, source, intent, agent,
  mine, follow-up, last touch, created, search, sort, page (≤ 10,000), page size
  (≤ 100), search text (≤ 120 chars). Visibility is in every query; an agent's agent
  filter is ignored (no widening); `mine` resolves server-side.
- **M-02 — fixed.** Search text is a bound parameter with `%`, `_` and `\` escaped:
  `%` finds only what contains a percent sign; quotes, SQL fragments, backslashes and
  100-character strings are literal; no interpolation, no SQL in any error.
- **M-04 — fixed.** `stage=garbage`, `stage=lead,garbage`, a bad `followUp`, `sort`,
  `agent` (shape), `page`, `pageSize`, `mine`, … are **400** naming the parameter;
  none becomes "every contact"; an empty value is "not given".
- **Snapshot = table.** Each card is computed by `count(*) filter (where …)` over the
  same predicate builder the table uses; asserted live (card == list `total` for every
  card) and offline.
- **Quick views** are presets over the one query (`QUICK_VIEWS`), not datasets.
- **Read this carefully:** `GET /api/contacts?q=…` deliberately **ignores** `q`
  (search text must not sit in a logged URL). It is not a widening — the caller only
  ever gets rows they may see — but it is the one parameter that is dropped silently.
  The screen never sends it. **P3:** answer 400 instead.

## 8. Follow-up and no-touch — preserved

Schedule / change / complete write no activity and never move last contact (live
follow-up workflow spec: agent 18/18, member, broker all pass on Leads V2).
Touch, touch + keep, touch + new day, touch + complete behave as certified;
America/New_York business-day classification is unchanged and shared. "No touch 14+"
reads `last_contact_at` (or creation for a never-touched person) and nothing else:
scheduling, completing, editing or reassigning cannot make a stale contact look
recent (asserted in the rendered SQL, offline, and live).

## 9. Non-regression

| | |
|---|---|
| MLS / Bridge / My Listings / FortMark Listings / detail / photos / comps / ⌘K MLS | **unchanged** (no file) |
| Transactions (create, stage, deadlines, metrics) | **unchanged** (no file); the quick-create diff is the lead branch only |
| Home | **unchanged**; it consumes the already-certified follow-up model |
| Team / Brokerage / Profile / Search | **unchanged** |
| AI (provider, model, registry, actions, prompt) | **unchanged** |
| Auth (Clerk, middleware, allowlist, authorizedParties, roles) | **unchanged** |
| Environment | **none required**; no flag, no variable, no Bridge change |
| Sample mode | Production reads `contacts=db`; the sample code is unreachable there (mock-leak suite 61/61) |

## 10. Timeline and audit metadata — special review

The browser receives only `{id, type, title, detail?, at, by?}`: a headline, what the
person wrote, a time and a profile name — no audit metadata, no actor id, no brokerage
id, no event type. Sources: activities (interactions, stage moves, reassignments) and
audit events (direct follow-up changes only — a reminder is deliberately **not** an
activity).

**Permitted metadata, exhaustively (every writer in `lib/contacts/service.ts`):**

| Event | Keys |
|---|---|
| `contact_created` | `contactId`, `source` |
| `contact_stage_changed` | `contactId`, `from`, `to` (+ `mechanism` for an AI-confirmed change) |
| `contact_updated` — touch | `contactId`, `activity`, `followUp` |
| `contact_updated` — direct follow-up | `contactId`, `field`, `followUp`, `mechanism`, and `day` (schedule only; a validated `YYYY-MM-DD`) |
| `contact_updated` — edit | `contactId`, `mechanism`, `fields` (names) |
| `contact_updated` — reassign | `contactId`, `field`, `mechanism` |
| activity, touch | `followUp`, `followUpDay` (only when the reminder moved) |
| activity, reassign | `event`, `fromAgentUserId`, `toAgentUserId` (dashboard user ids; **never returned** — the timeline shows a profile name) |

`scrub` additionally drops any key or value that looks like a secret, a session or a
Clerk id. **No** contact name, email, phone, notes, message content, property or
client data, and no request body. After certification a scan of every contact audit
row found **0** rows containing any synthetic name, email, phone digits or note text.
The added `day` is the reminder's own workflow date. **PASS.**

One nit (**P3**): audit-derived timeline items use the audit row's UUID as their
`id` (a React key). It reveals nothing, but a derived key would be tidier.

## 11. Read retry — special audit

`fetchOnce` (`lib/data/adapters/leads.ts`) retries **only a read that got no answer**:
the fetch threw (connection dropped / aborted) or the gateway said **502 or 504**.

- **Reads** = every GET (`source`, list, contact, agents, summary, timeline) and the
  one search POST explicitly declared `read: true`.
- **Never retried:** create, edit (PATCH), reassign, stage, follow-up, touch and
  "mark contacted" — each passes a non-GET method without the flag.
- **Bound:** exactly one retry after 400 ms. No loop, no back-off storm.
- **Never retried:** any answer the application gave — 400, 401, 403, 404, 409, 500,
  503 — so validation and authorization failures are surfaced once.
- Asserted by two structural checks in `test:leads`. **Reads only: YES. Max retries: 1.**

## 12. Performance

Leads page load (live): **1** list, **1** summary, **1** agents, **1** source probe
(+ the shell's own `subsystems`) — no duplicate, nothing per row. Drawer: contact +
timeline (+ roster, only for a privileged role and only while a drawer is open). Agent
names are resolved in one batch per page. No N+1.

**Timeline lookup index.** The audit lookup by contact id has no expression index.
Measured on Production (read-only `EXPLAIN ANALYZE`): a sequential scan of **178**
audit rows, **0.85 ms** execution. **PASS WITH NOTE:** fine at this scale; if audit
volume grows into the hundreds of thousands, add an expression index on
`(safe_metadata->>'contactId')` in a separate migration. Not added here.

## 13. Build, secrets, mobile, accessibility

| | |
|---|---|
| Clean worktree at `74ff9d4` | `npm test` — 19 suites, all green (Leads V2 277, follow-up 157, contacts 92, atomicity 48, MLS 225, transactions 168, shell 42, …); `tsc --noEmit` clean; `test:migrate` 23/23; `npm run build` compiled, all new routes listed |
| Client bundle (98 files) | 0 hits for `sk-ant-`, a bare `sk-` key, database URLs, Stripe-style keys, Blob tokens, bearer tokens, JWTs; none of the server-only variable **names** appear; `NEXT_PUBLIC_` = app URL, Clerk publishable key, sign-in URL only; nothing server-only is bundled |
| Mobile 390 / 430 | compact list, filters behind a disclosure, drawer holds every action, no horizontal page overflow (asserted live) |
| Accessibility | `aria-sort`, labelled filters and fields, disclosure `aria-expanded`/`aria-controls`, drawer focus, focus moved to the first invalid field, keyboard row open and header sort, reduced motion — all asserted live. A manual screen-reader pass was **not** run (desirable, not blocking) |
| **P3** | `useMinWidth` starts `false`, so a desktop first paint can draw the compact list for one frame before the table |

## 14. Rollback

Application-only; there is no migration. Current Production deployment
`dpl_JE8Sch3v753t68tyEbNJqB7ckJ2L` (`01f7f94`) is READY; the previous
`dpl_JDgtuMgnyZmb2mN5TtLeBcNzWvPn` (`a221c21`, runtime-identical) is READY too. The
old app reads everything the new code writes: timestamps and columns are unchanged;
extra audit keys (`day`, `fields`) and the `system` reassignment row are ignored by
the old code. (The Vercel tool could not confirm the "rollback candidate" flag; check
it in the dashboard before promoting.)

## 15. Human smoke plan (after a promotion)

Home · Leads (snapshot cards, *My leads*, *Due today*, *Overdue*, *No touch 14+*, a
filter combination, search, sort, next page) · open the existing contact (details,
Activity timeline, Edit contact UI) · reassign UI (privileged role) · follow-up
control · Transactions (it now has a real deal: look, don't edit) · Listings · My
Listings · FortMark Listings · ⌘K · Team · Brokerage. Look at Leads at a narrow width.

**Optional, operator-controlled:** edit a harmless field (say the company) on the
real contact, or schedule a real follow-up. Expect: the change appears; last contact
does **not** move on a reminder; the timeline names it; one audit event, field names
only. Nothing is mutated automatically.

## 16. Findings

- **P0:** none. **P1:** none.
- **P2:** none.
- **P3:**
  1. Documentation error corrected here: create does not refuse an unreadable phone
     (it keeps it as typed); only edit is strict. Behaviour is unchanged from before.
  2. Edit refuses phone shapes an agent may want (extension, `00…`, 7-digit local).
  3. `GET /api/contacts?q=` silently ignores `q` (by design); 400 would be tidier.
  4. Audit-derived timeline items expose the audit row's UUID as their key.
  5. Reassign target is not brokerage-scoped (no membership model; single brokerage).
  6. `useMinWidth` can draw the compact list for one frame on desktop.
  7. Timeline lookup has no index (measured fast; monitor as audit volume grows).
- **Known, deferred, not in this release:** Pipeline board and drag-and-drop;
  Unassigned (owner is required by the schema); editable intent (Opportunities are
  frozen); bulk actions; sort by assigned agent; M-03, M-05, M-06, M-07, M-08, M-09,
  M-10, M-12.
- **Not verifiable from here:** Production sign-in and the live signed-in smoke; the
  Vercel rollback-candidate flag; Production runtime logs for this project. The
  earlier log review and today's health probe are the evidence; traffic is thin.

## 17. Recommendation

Ready for **human authorization** to promote Leads V2: a code-only fast-forward of the
Production branch from `01f7f94` to the certified runtime, then the smoke above.
Nothing has been deployed or merged.

---

# PRODUCTION EXECUTION

Executed 2026-09-30, after the audit above was approved.

| | |
|---|---|
| Source | `74ff9d4` (the certified runtime; **not** the docs-only `ef815b9`) |
| Previous Production | `01f7f94` · `dpl_JE8Sch3v753t68tyEbNJqB7ckJ2L` |
| Action | Production/default branch `claude/fortmark-dashboard-build-v39u96` fast-forwarded `01f7f94` → `74ff9d4` (plain push at 02:42:23 UTC; no merge, no cherry-pick, no force, no conflict) |
| New deployment | `dpl_HHsoeTDXVxGoZFbAg5CZ7vdQ8z6L` — built by Vercel from the branch, target production, **READY** at 2026-09-30 02:43:22 UTC (created 02:42:24), aliased to `fortmark-dashboard.vercel.app` |
| Rollback target | `dpl_JE8Sch3v753t68tyEbNJqB7ckJ2L` (`01f7f94`) — READY before the push and **not needed**; `dpl_JDgtuMgnyZmb2mN5TtLeBcNzWvPn` (`a221c21`) also READY |

## Gates before the push
Working tree clean · default tip `01f7f94` · `01f7f94` an ancestor of `74ff9d4` (clean
fast-forward) · nine commits, all Leads V2 · **0** changes under `lib/db`, `lib/mls*`,
`lib/ai`, `lib/auth`, `lib/search`, `lib/transactions`, `lib/metrics`, `lib/brokerage`,
`lib/team`, `lib/profile`, `lib/flags.ts`, `middleware.ts`, `next.config.ts`,
`vercel.json`, `package-lock.json`, the listing/AI/chat/transactions/metrics/team/
brokerage/profile/search routes, Home or the app shell · **0** migration files · the
two commits after `74ff9d4` on the dev branch are documentation only and were not promoted.

## Health gate (after)
`GET /dashboard/api/health` → 200, `no-store`: `revision=74ff9d4`, `transactions=db`,
`contacts=db`, `listings=mls`, `homeMetrics=real-only`, assistant `openai` /
`no_credential`, `actions=disabled`. **Only `revision` changed.**

## Unauthenticated security smoke
- `/dashboard`, `/leads`, `/leads?followUp=overdue`, `/transactions`, `/listings`,
  `/settings` → 307 to sign-in with the return path; no loop.
- Anonymous `GET` on contacts, summary, agents, one contact, its timeline, metrics,
  transactions, team and listings → **401**, `no-store`; anonymous `PATCH` a contact,
  `POST` reassign and `POST` search → **401**, `no-store`. No record data, no 500.
- The authenticated safe probes (a `%` / `_` search, an invalid stage / follow-up /
  sort) need a Production session, which is not minted here; they were certified live on
  Preview and are on the operator's checklist.

## Database (read-only, counts only)
Migrations **11** (unchanged) · contacts **1** · activities **6** · opportunities **1** ·
transactions **1** (the operator's real deal, unchanged) · prepared actions **0** · users
1 · profiles 1 · brokerages 1. Contacts, activities and transactions are exactly as
before the deployment: it wrote nothing.

## Logs
**NOT VERIFIED.** The runtime-log tool available to this session is bound to a different
Vercel project (`i-dx-server`) and returned nothing for this deployment; that is not
evidence of a clean log. Evidence in hand: the probes above (200 / 307 / 401 only), the
health gate and unchanged counts. Please check the dashboard project's runtime logs for
5xx, 503, database, contacts / follow-up / Leads-query, Home-metrics and Bridge errors
after the signed-in smoke. Anonymous 401s are expected.

## Human signed-in smoke — PENDING (operator)
Not run by me (no Production session was minted or impersonated). Checklist: Home ·
Leads · the five snapshot cards (a nonzero card should equal the rows of the view it
opens; zero is acceptable when true) · My leads · Due today · Overdue · No touch 14+ ·
search · a filter combination · sorting · paging (only if the data reaches a second
page) · the existing contact's drawer and Activity timeline (plain-language lines, no
raw JSON or ids) · Edit contact · Reassign (only if your role is privileged) ·
follow-up controls · Transactions (the real deal renders; do not edit) · Listings · My
Listings · FortMark Listings · ⌘K with an exact MLS number · Team · Brokerage · Leads at
a narrow width.

## Optional real-contact mutation — SKIPPED
Not run; it is the operator's choice. Either schedule a real future follow-up (expect: the
reminder changes, last contact does **not**, no new touch activity, the timeline names
it, one audit event with field names and the day) or edit a harmless field (expect: only
that field changes; audit records the field name, never the value). Do not reassign
merely to test.

## Status and change log
**LEADS V2 LIVE** (deployment verified; the operator's signed-in smoke is outstanding).
Production changes: (1) default branch fast-forward `01f7f94` → `74ff9d4`; (2) one fresh
Vercel Production deployment. Nothing else — no environment variable, Bridge, Clerk, AI,
flag, migration or data change.

Known limitation recorded: there is no user-to-brokerage membership model (single
brokerage), so a reassignment target is "any active work-owning dashboard user".
