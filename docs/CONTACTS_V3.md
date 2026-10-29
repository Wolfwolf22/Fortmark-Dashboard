# Contacts V3

Status: **Built and certified on Preview. NOT in Production.**
Branch: `claude/dashboard-status-yir55p` · Production baseline: `74ff9d4` (Leads V2), untouched.
Schema record: [`CONTACTS_V3_SCHEMA_PROPOSAL.md`](./CONTACTS_V3_SCHEMA_PROPOSAL.md) (APPROVED / APPLIED TO PREVIEW).

## What changed

### Who sees what

| | Contacts | Transactions |
|---|---|---|
| `admin` | brokerage-wide | brokerage-wide |
| `broker`, `transaction_coordinator` | own only | brokerage-wide |
| `agent` | own only | own only |
| `member` | own only, read-only | read-only |

Decided by `role`, never by an email address. Anything outside a role's scope is **404**
(no existence leak); a read-only role that tries to write is **403**.
`lib/auth/actor.ts`: `isBrokerageAdmin`, `canSeePersonal`, `canWritePersonal`, `canCreatePersonalFor`.

### Transactions "nothing loading" (fixed, no migration)
A hidden global Month reporting period was applied to a work list, which dropped undated
opportunity deals. The list is no longer windowed by the period. Certified as admin and agent.

### Leads → Contacts
Page at `/dashboard/contacts`. `/dashboard/leads` answers **307** with the query string kept
(`next.config.ts`). Nav, ⌘K, New menu, Home and links updated.
For a personal-book role the "My leads" quick view is not shown (the whole list is already theirs).

### Reassignment is gone
No endpoint (the route is deleted: 404/405), no control, no owner input on create. Owner =
creator = actor. The historical timeline label stays; admins keep a read-only Owner filter and an
owner line in the drawer. No schema change.

### Notes (`contact_notes`)
Always-visible composer, 10,000-character limit, plain text only (never rendered as HTML), timestamp
shown, delete asks first and **removes the text, leaving a tombstone** (CHECK: live ⇒ body of 1–10,000
characters; deleted ⇒ `deleted_at` set and body null). No editing. The old `contacts.notes` block is
shown once as "Legacy note". Audit events carry ids only — never text.

### Birthday (`contacts.birthday_month`, `birthday_day`)
Month and day only, February 29 allowed, set / change / clear, "Not set" when empty. CHECK: both
null, or both set with a day valid for that month. No year and no age anywhere.

### Client needs (`contact_needs`)
Structured, several per contact, status `active | paused | fulfilled | archived`, **never deleted**.
Arrays for areas / property types / must-haves, integer cents for money, baths in half steps.
`getContactNeeds` (`lib/contacts/needs-service.ts`) is the single boundary the AI / MLS layer reads —
no Bridge field names cross it. Audit events carry field names only, never values.

### Drawer
Header → owner line (admin only) → quick actions → needs → notes → activity (latest 5 + a
disclosure for the rest) → representation → transactions.

### Stage change notice
Moving INTO `active_client` or `representation` shows a dialog; Cancel changes nothing, Continue
moves. The audit records the acknowledgement only. A contact already in Representation is not asked.
UI order puts `active_client` before `representation`; the database enum order is unchanged.

### Representation → Transaction
- A **Create transaction** button appears at `representation` only.
- The New Transaction dialog has a server-side selector of eligible contacts: stage
  `representation`, the caller's own scope, at most 25, name search escaped. Free text remains for a
  deal with no contact.
- The server re-validates on create (`invalid_contact`), makes the contact the primary client party
  through the existing `transaction_parties.contact_id`, and audits the link (ids only).
- The drawer lists linked deals. Legacy deals are unchanged.

## Migrations (Preview only)

| File | Adds |
|---|---|
| `0011_contact_notes.sql` | `contact_notes` + tombstone CHECK |
| `0012_contact_birthday.sql` | `birthday_month`, `birthday_day` + CHECK |
| `0013_contact_needs.sql` | `contact_needs`, enums, array / money / baths checks |

No M4 (private engagement documents) and no M5. `scripts/test_migrate.mjs` runs them on a real
PostgreSQL 16 (66 checks, including the constraints). Production still has 11 migrations and none
of these tables; Production's migration step is a separate, later gate.

## Private engagement storage — NOT provisioned (operator step)
The Blob tooling available here cannot scope a store to Preview only; its default link would also
affect Production environment variables and would collide with the generic Blob token. The public
profile-photo store must never be used for engagement documents. To provision, an operator runs:

```
vercel blob create-store <name> --access private --region iad1 --environment preview
```

(or uses the dashboard connect dialog, choosing the Preview environment only, with a distinct
variable name — planned `ENGAGEMENT_BLOB_READ_WRITE_TOKEN`). M4 and the hard-block of regular users
until an executed agreement is attached remain a separate gate. Requirements are in section 5 of the
schema proposal. No `CONTACT_ENGAGEMENTS_STORAGE.md` exists because nothing was provisioned.

## Security rules held
- Note bodies, need values and birthday values never appear in audit metadata, global search, ⌘K,
  URLs, query parameters or client logs.
- Notes and freeform need fields render as plain text; `<img onerror>` payloads were stored and shown inert.
- No email is used as an identity or an ownership key; nothing is hard-coded to a person.
- Private data responses are authenticated, authorized and `no-store`.

## Certification (Preview)
Fixtures were synthetic ("CV3 …"), seeded on the Preview branch, and removed afterwards.

- **API**, per role (admin, agent, broker, coordinator, member) plus a contact in another brokerage as
  the isolation control: every refusal is paired with the same request succeeding for a role allowed to
  make it.
- **UI**, signed in through Clerk against the deployment (`e2e/contacts-v3-ui.spec.ts`):
  - admin: all 18 steps passed, across three runs on the same code (`80c4170`; later commits only touched docs and the spec) — steps 1–11 in one run, then 12–18 in another after the run was stopped by a click that raced hydration; not one uninterrupted pass;
  - agent: 17 passed, 1 skipped (member-only step);
  - member: 11 passed, 7 skipped (write paths a read-only role cannot take).
  - Widths 390, 430, 1280 and 1440 with no sideways scrolling; every control named; reduced motion checked.
- Platform flakes (502s, aborted reads, a dropped chunk, Clerk not initialised, a New menu / New contact
  click that raced hydration) are counted and printed by the specs, never hidden. No product exception
  (`uncaught=0`) was seen in any run.

Defects found live and fixed: the contact picker flashed a free-text "Client name" box when a cleared
search had not reloaded; a dialog opened from the New menu lost focus because its opener (a menu item)
closes with the menu; dialogs opened from state did not restore focus; focus after deleting a note fell to
nothing; a duplicate accessible name on the areas list.

Not exercised through the browser: broker and coordinator (covered by the API spec, whose Transactions
and Contacts expectations are the role table above).

## Tests
`npm test` (20 suites, includes `test:contacts-v3` 324 checks), `npm run test:migrate` (66),
`npx tsc --noEmit`, `npx next build` — all green on the committed code.

## Reliability follow-up — 2026-10-29

The certification and deployment statements above describe the earlier release.
This follow-up was implemented and verified locally; it has not been deployed or
applied to a live database.

- **Creation:** `POST /api/contacts` now requires a UUID `requestId`, kept across
  retries of one creation dialog. Contact, legacy opportunities, history, audit
  and the scoped request receipt commit together. Reusing the key with a different
  payload returns `409 request_conflict`; a lost response can recover the same
  contact. Apply additive migration `0015_contact_create_requests.sql` before
  serving the updated database-backed creation route. Existing identity and
  ownership rules remain unchanged.
- **Editing:** stored-contact PATCH requires `expectedUpdatedAt`, from the contact's
  public `updatedAt`. Conditional writes refuse stale revisions with `409 conflict`.
  Tokens handle existing PostgreSQL microseconds and advance monotonically. Contact
  details and birthday drafts retain their opening baseline and require explicit
  review of newer saved values. Only intentionally changed fields are submitted.
- **Touches and reminders:** touch history, last contact, reminder changes and audit
  commit atomically. A reminder kept by a touch is evaluated from the locked current
  row rather than copied from an earlier read. Internal note/task events do not
  claim outreach. Quick contact marking is labelled `Marked contacted`, including
  legacy events. AI preparation and execution use the same contact write permission
  rule, and AI reminder writes also advance the revision token.
- **Client Needs:** structured needs become authoritative once any exist; only active
  rows contribute intent, budget and searchable areas. Contacts without structured
  needs retain their legacy opportunity summary. Pausing or fulfilling the last
  structured need does not resurrect an old legacy intent. Financing, must-haves,
  exclusions and additional requirements have an authorized read view for every
  status. Private detailed requirements and note bodies remain outside list search.
- **History:** notes, needs and timeline GET routes support `pageSize` (1–100) and an
  opaque `cursor`, returning `{items, hasMore, nextCursor}`. The UI requests 25 at a
  time and loads older pages explicitly. Tied timestamps and derived follow-up
  entries have deterministic boundaries; each page repeats contact authorization.
  Calls without paging parameters retain the older array response shape. Loaded
  counts are distinguished from complete totals. Final-page controls retain focus.
- **Workspace:** private search resets pagination; out-of-range pages recover after
  results shrink. Upcoming sorts by earliest reminder; mobile has sorting. Drawer
  state follows the URL and browser history. Focus/visibility changes and business-day
  rollover refresh the contact workspace without clearing an editor's draft.

Regression coverage now includes isolated PostgreSQL rollback, retry, concurrent
edits and reminder writes, structured-needs lifecycle/filter consistency, and
more-than-100-entry notes/needs/activity paging. The database test helper applies
committed migrations only inside an in-memory PostgreSQL instance and does not read
live connection settings. Browser checks use the read-only synthetic preview.

Local verification: the complete project suite passed, with 3,993 counted checks
after the final AI permission regressions, plus the workspace ownership/conflict
suite. TypeScript and whitespace checks passed. The native migration-runner
integration test was skipped because PostgreSQL server binaries are unavailable
on this host; the committed migrations and new receipt schema were exercised by
the isolated PostgreSQL test harness. Live deployment and authenticated live-data
certification remain separate from this local implementation.
