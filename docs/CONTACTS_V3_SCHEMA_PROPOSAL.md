# Contacts V3 — architecture and schema proposal

Status: **APPROVED / APPLIED TO PREVIEW** (M1, M2, M3). M4 is not applied and is its own gate. **Nothing is in Production.**
Implementation, behavior and certification: see [`CONTACTS_V3.md`](./CONTACTS_V3.md). What follows is the proposal as it was reviewed; the "Decisions taken" block below records how the open questions were closed.
Date: 2026-09-30 · Branch: `claude/dashboard-status-yir55p` · Production baseline: `74ff9d4` (Leads V2)

This document is the gate required before any Contacts V3 schema work. It records
what was audited (with the evidence), what each requested feature needs from the
database, and the smallest additive migration set that delivers it. Production
values quoted here are shapes and counts only; no client data appears.

---

## 1. Transactions "nothing loading" — exact root cause

**Cause: a hidden reporting-period filter applied to a work list.**

1. `app/(app)/transactions/page.tsx` read the *global* reporting period
   (`useDateRange`, zustand, default preset **Month**) and passed its `range` to
   `getTransactions(...)`.
2. The adapter sent `from`/`to`; `listTransactions` (`lib/transactions/service.ts`)
   then added: `contract_execution_date` in window **OR** `closing_date` in window.
3. That period is chosen on **Home and Reports only**. The Transactions page has no
   control for it, so the user could neither see nor change the filter.
4. A deal in the `opportunity` stage has no contract date and usually no closing
   date. `NULL` never satisfies the window, so it can never match.

**Evidence (Production, read-only):** 2 transactions, both `stage = opportunity`,
`contract_execution_date` NULL, `closing_date` NULL, both owned by an `admin` user
in the brokerage. Rows matching the current-month window: **0**. Matching the full
2026 year window: **0**. So even switching the period to "Year" (if a control had
existed) would not have shown them.

**Ruled out:** authorization (admin is privileged; `visibleTo` is brokerage-wide for
admin/broker/transaction_coordinator), owner filtering (both rows' owner exists and is
in the brokerage), server component/API (route returns whatever the service returns),
client rendering and zero-state (the board renders `opportunity` as a column),
relationship filtering (no contact join on this path). It also affects every role:
an agent with only undated deals sees an empty page too.

**Fix — application code only, no migration (implemented in this branch):** the
Transactions page no longer sends the reporting period. It is a work list, not a
report. The server-side window support is kept for callers that pass one.
Regression checks are in `scripts/test_transactions.ts` (171/171). The board and
table empty-state copy no longer claims "in this period".

**Preview certification (`e18615a`, `e2e/transactions-visibility.spec.ts`, 4/4 per role):**
two synthetic undated opportunity deals (one owned by the certification identity, one
by a synthetic colleague). At the default Month period, no `from`/`to` sent:
admin sees both on the board, the table and the API (colleague's deal opens, 200);
agent sees only their own, and the colleague's deal is 404. Fixture removed; Preview
returned to 0 transactions, 1 user, role `member`, 11 migrations.

---

## 2. Rename Leads → Contacts

Audit of the surface: nav item (`components/layout/nav-items.ts`), `ROUTES.leads`,
page (`app/(app)/leads`), ⌘K/search hrefs (`lib/contacts/search.ts`), metrics deep
links (`lib/contacts/metrics.ts`), sample metrics, quick-create redirect, and about
a dozen e2e navigations. `/dashboard/leads?...` URLs also exist in operator bookmarks.

**Recommendation (safest):**

1. Create `app/(app)/contacts/page.tsx` as the canonical route (move, do not fork).
2. Add a **temporary (307)** redirect `/leads → /contacts` in `next.config.ts`
   `redirects()`. Next carries the query string and applies the `/dashboard`
   basePath, so `?open=`, filters, sort and page survive; back/forward stay correct.
   Use 307 first; move to 308 only after Production has run on it (a cached 308 is
   the one part of this that cannot be rolled back from the server side).
3. Point nav, `ROUTES`, search hrefs, metrics links and quick-create at `/contacts`;
   the active-nav rule already matches on path prefix.
4. Keep the API path `/api/contacts` (already correctly named).

Fallback if the redirect proves risky behind the portal rewrite: keep `/leads`
internally and rename only the label. Not expected to be needed.

---

## 3. Ownership and authorization (current truth)

`contacts` already has **three separate columns**:

| Column | Meaning today | Nullable / FK |
|---|---|---|
| `assigned_agent_user_id` | the owner used by every visibility and write check | NOT NULL, `restrict` |
| `created_by_user_id` | who created the row | nullable, `set null` |
| `updated_by_user_id` | last editor | nullable, `set null` |

Creator, owner and assignee are *conceptually* conflated (the owner column is called
"assigned agent") but are **stored separately**. On create, both are set to the actor.
They can diverge only through the reassign feature (or a privileged create naming
another owner). Production: 1 contact, `created_by = assigned_agent`, owner role admin.

**Conclusion: no schema change is needed for ownership.** Keep
`assigned_agent_user_id` as the authoritative owner (NOT NULL + `restrict` is exactly
the stable identity wanted; `created_by` is deliberately nullable). Once reassignment
is removed and privileged create-for-another is disabled, owner ≡ creator for every
new contact. Ownership identity is the internal `dashboard_users.id`; no email is used.
A future cosmetic rename of the column is optional and not proposed.

### Current policy vs requested

Today one helper serves Contacts and Transactions: `PRIVILEGED_ROLES = admin, broker,
transaction_coordinator` see and write the whole brokerage; agents own-only; members
read-only (and, owning nothing, see nothing).

| Role | Contacts (requested) | Transactions |
|---|---|---|
| **admin** | all brokerage contacts, all drawers, brokerage-wide metrics, manage per admin policy | all brokerage deals (unchanged) |
| **agent** | own only; write own only | own only (unchanged) |
| **member** | read-only, own only (owns none) — unchanged | unchanged |
| **broker** | **own only** (change from V2) | *decision needed* — recommend keep brokerage-wide |
| **transaction_coordinator** | **own only** (change from V2) | *decision needed* — recommend keep brokerage-wide |

**Decision needed (not silently assumed):** a transaction coordinator's job is to
coordinate deals owned by agents, so removing their brokerage-wide *Transactions* view
would break the role. Recommendation: Contacts become admin-only-wide (a new
`isBrokerageAdmin(actor)` predicate: `role === "admin"`, never an email); Transactions
keep `isPrivileged`. This splits one shared rule into two named ones; it is a code
change, not a schema change, and applies to list, get, search, counts and metrics
through the existing `visibleTo`.

### Reassignment removal plan (no data loss, no schema change)

- Remove UI: reassign control, assignee picker, `getLeadAgents` in the drawer.
- Remove the mutation: `reassignContact`, `POST /api/contacts/[id]/reassign`, the
  `assignedAgentUserId` create input (server always uses the actor).
  Dependencies found: drawer, timeline, adapter, sample data, `test_leads_v2.ts`,
  and the `reassigned` timeline event label — the last one **stays** so historical
  audit rows still render.
- Keep `GET /api/contacts/agents` for the admin-only **Owner** filter (read-only).
- Historical assignment data is untouched.

---

## 4. Stages

`contact_stage` enum, exact order as declared:

`lead, contacted, qualified, appointment, representation, active_client,
under_contract, closed, past_client, lost, archived`

- **Active Client — exists** (`active_client`).
- **Representation — exists** (`representation`).
- `past_client` exists, so the "Past Clients" view is truthful.

**No enum change and no data migration is required.** Two things to know:

1. `ACTIVE_CLIENT_STAGES` (Home metric definition) is
   `representation + active_client + under_contract`. The Contacts view
   **"Active Clients"** should be `stage = active_client` only, and
   **"Representation"** `stage = representation`; the Home metric keeps its broader
   definition. These are different questions and both should be labelled honestly.
2. Your lifecycle sketch reads Active Client → Representation, but the enum (and
   therefore SQL `ORDER BY stage`) has Representation first. Postgres enums cannot be
   reordered without a migration; UI ordering can be set in `stages.ts` without one.
   Recommendation: leave enum order, order the *view list* in the UI.
   Transitions within the lifecycle are already unconstrained (`canTransition`).

Production has one contact, already at `representation` — it predates the engagement
gate and would be grandfathered (the gate applies to transitions *into* the stage).

---

## 5. Private document storage (broker engagement)

**Private attachment support today: NO.**

- The only Blob usage is profile photos (`lib/profile/image-storage.ts`), written with
  `access: "public"`, in a store addressed by `PROFILE_BLOB_READ_WRITE_TOKEN`
  (fail-closed in Production, never falls back to the generic token).
- Production env (names only) contains no second store and no engagement token.
- `@vercel/blob@2.6.1` *does* declare `access: 'private'` and a `get()` that reads
  private blobs with a token, so the SDK is not the blocker — **no private store is
  provisioned or configured**. Access mode is fixed when a store is created, so this is
  an operator action (create a second, private store; add
  `ENGAGEMENT_BLOB_READ_WRITE_TOKEN` to Preview and Production).

**Result for that portion: `BLOCKED ON PRIVATE DOCUMENT STORAGE`.** It will not be
worked around with a public blob, and the profile store must not be reused.

What can proceed without it: the **broker-engagement confirmation modal** (copy in the
brief), recorded as an acknowledged, audited step. What cannot: the "hard-block
regular users until an executed agreement is attached" rule, because there is nothing
to check. Proposed sequencing: ship the modal with an audited acknowledgement now;
enforce and add attachment once the private store exists.

Requirements the eventual implementation will meet (recorded so review can approve
them now): authenticated + authorized download route only; opaque random storage key
(never derived from name, contact or email); PDF-only, verified by magic bytes, ≤ 10 MB;
`Content-Disposition: attachment`, `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex`; never a raw blob URL in the browser; upload/download audited by
ids, never filename or content; fail closed in Production if the token is absent.

---

## 6. Contact ↔ Transaction relationship

**Already modelled — no schema change required.**

- `transaction_parties.contact_id` — nullable FK → `contacts.id`, `ON DELETE SET NULL`,
  indexed (`transaction_parties_contact_idx`). No uniqueness → one contact can be on
  many transactions, and a transaction can carry several contacts (two buyers).
- `contact_opportunities.transaction_id` — the (currently unused by this design) link
  from a need-like row to the deal it became.

Gap is in code only: `createTransaction` writes parties with a `displayName` and never a
`contact_id`, and Quick Create's client is free text. Legacy deals have parties with
NULL `contact_id` and continue to render unchanged; **no backfill is needed** to deploy.

Proposed flow: **Contact (Representation) → Create Transaction (user-confirmed) → deal
with a client party carrying `contact_id`, `is_primary = true`.** The Contact drawer's
Transactions section is `transaction_parties where contact_id = ?` joined to
`transactions` under the *transactions* visibility rule (a contact never reveals a deal
the viewer may not see).

Optional hardening (not required): partial unique index on
`(transaction_id, contact_id) WHERE contact_id IS NOT NULL` to prevent the same person
being linked twice to one deal. Additive, cheap; listed as M5.

### New-transaction contact selector (server-side)

Endpoint returns at most 25 rows, `stage = 'representation'`, within the caller's
*Contacts* visibility (admin: brokerage; others: own), name search with the existing
escaped-and-bound matcher (`escapeLike`). Archived and lead-stage contacts are excluded
by the stage predicate itself. Server also re-validates on create: the contact must be
visible, `representation`, same brokerage, and its owner must equal the transaction's
agent unless the actor is admin.

---

## 7. Proposed migrations

Next migration number is `0011` (Production has `0000`–`0010` applied). All are
**additive**: new tables, or nullable columns. No existing column is altered, dropped or
backfilled. All are applied to Preview first via the existing atomic runner.

| # | Migration | Reason | Risk | Backfill | Rollback |
|---|---|---|---|---|---|
| M1 | `contact_notes` | first-class timestamped notes, soft delete | low — new table | none; legacy `contacts.notes` stays and is shown read-only as "Legacy note" | `DROP TABLE contact_notes` (feature off first) |
| M2 | `contacts.birthday_month`, `birthday_day` | optional birthday, no year | low — 2 nullable cols + CHECKs | none | drop two columns (feature off first) |
| M3 | `contact_needs` (+ 3 small enums) | structured client needs, many per contact | low — new table | none | `DROP TABLE` + `DROP TYPE` |
| M4 | `contact_engagements` | engagement record + private document reference | **blocked** on private store | none | `DROP TABLE` |
| M5 (optional) | unique `(transaction_id, contact_id)` partial index on `transaction_parties` | prevent duplicate link | low — fails only if duplicates exist; there are none (no rows have `contact_id`) | none | `DROP INDEX` |

No migration is needed for: ownership, stage, transaction linkage, admin visibility,
Leads→Contacts rename, reassignment removal, or the new audit event names (the audit
event list is a code constant, `RELEASE_1_AUDIT_EVENTS`).

### M1 — `contact_notes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default random | |
| `contact_id` | uuid NOT NULL FK → `contacts.id` ON DELETE CASCADE | contacts are archived, never hard-deleted; cascade matches `contact_activities` |
| `author_user_id` | uuid FK → `dashboard_users.id` ON DELETE SET NULL | display name resolved server-side; a removed user shows as "Former team member". Never sent as an id |
| `body` | text NOT NULL, CHECK `char_length(body) BETWEEN 1 AND 5000` | |
| `created_at` | timestamptz NOT NULL default now() | shown in `America/New_York`, e.g. `Sep 29, 2026 · 4:42 PM` |
| `deleted_at` | timestamptz | soft delete |
| `deleted_by_user_id` | uuid FK → `dashboard_users.id` ON DELETE SET NULL | |

Index: `(contact_id, created_at DESC) WHERE deleted_at IS NULL`.
No edit path in this phase (a correction is a new note). Notes are **not** added to
`contact_activities` (its `summary` would copy the body into the timeline and search
surfaces) and are **not** searchable. Adding a note does **not** move `last_contact_at`
(a note is not a touch — same doctrine as follow-up reminders).

Existing data: 2 `contact_activities` rows of kind `note` exist in Production. They
remain timeline history, untouched. Legacy `contacts.notes` is preserved and shown once
as "Legacy note" with no manufactured timestamp; the Edit form stops offering it.

Retention (**decision needed**): soft-deleted bodies are retained, hidden from every API
response, and only reachable by a database operator. Recommendation: keep indefinitely
until a retention policy is set; do **not** blank on delete (recoverability against
mistaken deletes matters more than early purge, and no purge job exists). If you prefer
purge-on-delete, that is a one-line change (`body = ''`) before Production.

Authorization: read = can see the contact; add = can write the contact (admin, or the
owner; not `member`); delete = the contact's owner or an admin — not the note author
alone if the author is a different user. Out-of-scope contact ⇒ 404 (no existence
leak), identical to today.

Audit (ids and action only, never the body): `contact_note_created`,
`contact_note_deleted` with `{ contactId, noteId }`.

### M2 — Birthday

Two nullable `smallint` columns: `birthday_month` (1–12), `birthday_day` (1–31), with
CHECKs: both NULL or both set; day valid for the month (Feb 29 allowed).

Tradeoff vs a `date` column: a `date` needs a year. A sentinel year invents data,
invites age calculation, and shifts across timezones on serialization. Month/day is the
minimum a birthday reminder needs and stores nothing sensitive that was not asked for.
Displayed as `March 17`; empty shows `Not set`. Not in global search. Audit:
`contact_updated` with field name `birthday` (no value).

### M3 — `contact_needs`

Purpose: clean structured requirements a future service can translate into an MLS
query. **Not an Opportunity** (no forecast, no won/lost). The existing
`contact_opportunities` table is left exactly as is (it drives derived intent and is
free-text); consolidating the two is explicitly out of scope.

Enums (small, closed, additive `ALTER TYPE` later): `need_kind`
(`buy, sell, rent, lease, other`), `need_status`
(`active, paused, fulfilled, archived`), `financing_type`
(`cash, conventional, fha, va, other, unknown`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `contact_id` | uuid NOT NULL FK → contacts ON DELETE CASCADE | |
| `kind` | `need_kind` NOT NULL | |
| `status` | `need_status` NOT NULL default `active` | |
| `property_types` | text[] NOT NULL default `{}` | FortMark domain values, validated in the service, max 8 — text not enum so the list can grow without DDL |
| `areas` | text[] NOT NULL default `{}` | cities / neighborhoods as FortMark names them, max 12 |
| `price_min_cents`, `price_max_cents` | bigint | CHECK `min <= max` when both set |
| `beds_min` | smallint | |
| `baths_min` | numeric(3,1) | halves allowed |
| `sqft_min` | integer | |
| `target_date` | date | move / purchase date, when known |
| `timeline_note` | text ≤ 200 | e.g. "after lease ends" — kept short, not a notes box |
| `financing` | `financing_type` | |
| `must_haves`, `avoid` | text[] NOT NULL default `{}` | ≤ 20 items × ≤ 80 chars |
| `additional` | text ≤ 2000 | the only freeform field |
| `created_by_user_id`, `updated_by_user_id` | uuid FK → users SET NULL | |
| `created_at`, `updated_at` | timestamptz | |

Index: `(contact_id, status)`. **One active need is a UI limit, not a database
constraint** — a partial unique index would corner the design against the
buy-and-sell-at-once case the brief calls out.

No column uses Bridge/RESO field names. A future MLS service owns the mapping
(`price_min/max` → list-price range, `areas` → its city/subdivision resolver, `beds_min`
/`baths_min`/`sqft_min` → its numeric filters, `property_types` → its type resolver).

**Future AI/MLS access** goes through one authorization-aware service,
`getContactNeeds(ctx, contactId)` in `lib/contacts/needs.ts`, taking the same `Ctx`
(actor + db) as every contacts function. It returns `null` for a contact the actor
cannot see, exactly like `getContact`. AI tools call the service; they never read the
table. Freeform arrays (`must_haves`, `avoid`, `additional`) may hold sensitive
preferences: never searchable, never in audit metadata, never logged.

Audit: `contact_need_created` / `contact_need_updated` with **field names only**.

### M4 — `contact_engagements` (blocked; shape only)

`id`, `contact_id` (FK cascade), `uploaded_by_user_id` (FK set null), `storage_key`
(opaque random pathname in the *private* store — never a URL), `content_type`
(CHECK = `application/pdf`), `size_bytes` (CHECK ≤ 10 MB), `sha256`, `effective_date`,
`expiration_date`, `status` (`active | superseded | revoked`), `created_at`,
`superseded_at`. Index `(contact_id, status)`. Original filename is **not** stored
(filenames often contain client names). Not applied until the private store exists.

Representation gate once available: regular users are **hard-blocked** from moving a
contact into Representation without an `active` engagement. An admin override is **not**
proposed — no documented business need exists; if one appears it should be an explicit,
audited, reason-required action rather than a silent bypass. The confirmation modal
states that the software does not judge the agreement's legal sufficiency.

---

## 8. Audit events (code constant, no migration)

New event types: `contact_note_created`, `contact_note_deleted`,
`contact_need_created`, `contact_need_updated`, `contact_birthday_changed`,
`contact_representation_acknowledged`, `contact_engagement_uploaded` (with M4),
`contact_transaction_linked`. Metadata carries ids, field names, mechanism and outcome —
never note text, need values, birthday, filenames or contact details.

---

## 9. Privacy and API rules for the new data

Birthday, notes, needs and engagement documents are private CRM data. Every route:
authenticated, actor-scoped, `Cache-Control: no-store`, and 404 (not 403) outside scope
for reads. None enters global search, ⌘K, list endpoints or the AI tool surface except
through the authorized service. Notes and needs are never part of the contacts list
payload (only the drawer fetches them, on open).

---

## 10. Recommended smallest implementation plan

1. **Now, no schema (safe to certify in Preview immediately):**
   Transactions fix (done); Leads → Contacts rename + redirect; remove reassignment;
   admin-only contact visibility (`isBrokerageAdmin`); Transactions role rule kept;
   Contact drawer restructure (activity collapsed to latest 5 + disclosure, Owner line
   for admin, Transactions section); server-side Representation contact selector and
   `contact_id` on create; the stage warning modal with audited acknowledgement.
2. **After you approve M1–M3 (and decide the retention and TC questions):** apply to
   Preview only; notes, birthday, needs UI + services + tests + a11y/mobile pass.
3. **After you provision a private Blob store:** M4, the attachment flow and the
   Representation hard-block.
4. Production promotion is a separate, later phase with its own audit.

## 11. Open decisions

### Decisions taken (implementation phase)

| # | Decision |
|---|---|
| 1 | Transactions: admin, broker and coordinator stay brokerage-wide; agent own only. Contacts: admin brokerage-wide, everyone else own-only, member read-only. |
| 2 | Deleting a note removes its body (a CHECK enforces a null body with `deleted_at` set) and leaves a tombstone. Stricter than "retain, hidden". |
| 3 | M1 `contact_notes`, M2 birthday month/day, M3 `contact_needs` applied to Preview only (`0011`–`0013`). No M4, no M5. Notes are limited to 10,000 characters. |
| 4 | Private store NOT provisioned (the tooling cannot scope a store to Preview only). Operator step is in `CONTACTS_V3.md`. M4 stays blocked. |
| 5 | "Active clients" = `active_client` only. |
| 6 | `/dashboard/leads` answers **307** (not 308) to `/dashboard/contacts`, query string kept. |

### Original open decisions (as proposed)

1. Broker / transaction coordinator Transactions scope — recommend keep brokerage-wide.
2. Soft-deleted note body retention — recommend retain, hidden.
3. Approve M1, M2, M3 as written (M5 optional).
4. Provision a private Blob store to unblock M4, or defer engagement attachment.
5. Confirm view semantics: "Active Clients" = `active_client` only; Home metric unchanged.
6. Confirm 307 (then later 308) for `/leads → /contacts`.

## 12. Production impact of this phase

None. No deployment, migration, data write or environment change was made to
Production. The only Production access was read-only SQL (counts and non-identifying
shape columns) for the Transactions root cause, and — in the implementation phase —
one read-only check that Production still has 11 migrations and none of the V3 tables.
