# Contacts V3

Status: **Built and certified on Preview. NOT in Production.**
Branch: `claude/dashboard-status-yir55p` · Production baseline: `74ff9d4` (Leads V2), untouched.
Schema record: [`CONTACTS_V3_SCHEMA_PROPOSAL.md`](./CONTACTS_V3_SCHEMA_PROPOSAL.md) (APPROVED / APPLIED TO PREVIEW).

**Current local release — 2026-11-02:** the reliability, client-context, Next Action,
CSV import, reviewed merges, named MLS property lists, private property research and the showing planner below are implemented locally.
The historical Preview certification above does not certify these additions on a
deployment. Migrations **0015–0022 remain unapplied to live databases**; Production
was not changed by this work.

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

## Optional client context and Other descriptions — 2026-10-29

Migration `0016_contact_details_and_need_other.sql` adds optional `contacts.about`
and `personal_details`, plus nullable `kind_other`, `property_type_other` and
`financing_other` on needs. It is additive and follows the still-required 0015
creation-receipt migration. Neither has been applied to a live database by this
local task.

The client Details section now supports an About note (2,000 characters) and up
to 20 named details (label 60, value 500). Blank rows are omitted; partial rows,
unsupported NUL characters and over-limit text are refused. Authorized detail
reads include these values; list results, search, existing AI tool DTOs and audit
metadata exclude their content. Edits use the opening revision and explicit
saved/draft conflict review. This is editable reference context, distinct from
append-only chronological Notes.

Other descriptions appear next to the relevant need choice, are limited to 200
characters and render as plain text for every readable need status. New selected
Other values must be described. Legacy Other rows without descriptions stay
readable and may change status without a forced content rewrite. Changing a
selection keeps the local draft but clears an inactive description on save.

Contact-stage controls expose valid lifecycle moves and explicit archive/restore.
The stage observed when an action or confirmation began is checked again at the
write boundary, and competing changes roll back the entire transition/history
batch. Stage predicates used by contact lists, snapshots, Home active-client and
follow-up counts share one definition. Closing a relationship does not close its
separate transaction. Sample stage updates also leave touch dates unchanged.

Home attention formats its calendar-day due dates without a viewer-timezone
shift, so a saved October 29 reminder stays October 29 in New York as well as
on the contact profile. Home's Active clients total opens the matching shared
three-stage contact filter. The exact-stage quick view keeps its existing URL
contract and is labeled Active client stage to distinguish that narrower set.

Local verification includes the complete project suite (more than 4,400 counted
checks after the final targeted regressions), isolated PostgreSQL persistence
and rollback checks, and 11 interactive-preview contract groups. Browser checks
saved and read back About/named details and all three Other descriptions,
changed/archived/restored a stage, checked the shared Home count, and inspected
the editor at 390px and 320px with no horizontal overflow. Interactive samples
allow only these changes in memory and reset on reload; live-data certification
and deployment remain separate.

## Next Action workspace — 2026-10-29

Migration `0017_contact_next_action.sql` adds one pending structured action per
contact: ID, type (call/email/text/meeting/custom), purpose, due instant and
assigned dashboard user. The database enforces all-or-none fields, bounded
purpose, a valid kind, a real user reference and the reminder-day mirror.
Existing reminders remain unchanged until deliberately adopted into an action.
Migrations 0015–0017 have been prepared locally; this work applies no live updates.

The contact profile schedules and edits actions, records a required completion
outcome with an optional successor in the same save, and records a reason when
cancelled. Active assignment choices are the contact owner and administrators
who already have access. Assignment grants no new contact visibility. If a
chosen person becomes unavailable, the editor keeps the draft, refreshes the
team list and requires a new explicit choice.

Every mutation freezes the opening contact revision and pending action ID.
Concurrent changes require explicit review; a completion/cancellation draft
cannot be applied to a replacement action. The current action, day mirror,
task history and content-free audit commit atomically. Completing or scheduling
never changes last contact. An unavailable response causes shared reads to
refresh, and no write is automatically retried. Legacy reminder and AI follow-up
writes cannot overwrite a pending structured action, including same-day writes
or races after preparation. A normal logged touch can still keep the action.

Actions store an exact instant and display Eastern time. New or changed deadlines
must be in the future and within 730 calendar days in the business timezone; an unchanged overdue time
can be retained while editing another field. Nonexistent spring-forward times
are refused; newly selected repeated fall-back times choose the earlier
occurrence, with explicit guidance. Editing an unchanged local minute preserves
the exact original instant, including seconds and a later repeated occurrence.

The contact list, filters, snapshots and Home share timed overdue classification.
An action earlier today is overdue even though its calendar-day difference is
zero. Old reminders keep their day-based behavior. Home shows action type,
purpose, assignee and time; completed future successors leave the due queue.
Task outcomes stay in authorized contact history. Home's recent activity uses
a task icon and controlled event titles rather than presenting them as calls.
Visible Contacts and Home refresh time-sensitive state at minute boundaries,
on return and at business midnight, while keeping editors' drafts.

Verification covers 4,646 counted checks across the complete local project
suite, plus its unnumbered personal-workspace suite. New coverage includes 92
backend checks, 54 actual PostgreSQL cross-view checks, 30 UI/state checks and
61 real-adapter checks. The isolated preview adds 10 next-action contract
groups alongside its 11 existing groups. Browser verification uses synthetic,
memory-only samples; this is separate from authenticated deployment testing.

## CSV import and reviewed contact merge — 2026-10-29

### CSV review and commit

The import dialog parses CSV locally before sending only the mapped, corrected
fields for a read-only server preview. Bounds are **1 MiB, 250 data rows, 50
columns and 10,000 characters per cell**; mapped requests are also bounded to
1 MiB. The parser handles a UTF-8 BOM, CRLF/LF records, comma/semicolon/tab
delimiters, quoted multiline cells and escaped quotes. Malformed quoting or
inconsistent row widths are refused rather than silently changing the file's
meaning. Cells remain text; formulas are never evaluated.

Supported mappings are first name, last name, preferred name/full name, email,
phone, company, source, stage, About and Notes. A full name is preserved as the
preferred/display name rather than guessed into first and last names. Email and
phone use the shared normalization rules; source/stage accept known enum values
and stable display labels. Row field errors can be corrected and checked again
before applying anything.

Each reviewed row has an explicit add, update or skip decision. Exact normalized
email/phone matches and in-file duplicate identifiers default to skip. Creating
a separate record despite an exact match requires an explicit separate-record
choice; updating requires a selected target and its reviewed revision. Similar
names are advisory and never cause an automatic merge. Preview shows at most 50
candidates per row and states when more exist. The full exact-match set,
including identifiers retained on merged aliases, still participates in the
review fingerprint and commit guard.

Imports and duplicate suggestions use the caller's own contact book, including
for administrators. New contacts belong to the caller and default to Lead.
An update never reassigns ownership. **Blank mapped values do not clear saved
fields.** CSV Notes append separate chronological note records; neither existing
notes nor the legacy note column is overwritten. A blank-only, unchanged update
is reported as skipped without changing its revision or history. Imported stage
changes follow the normal lifecycle graph; entering Representation or Active
client requires the batch engagement acknowledgement. Importing does not send
messages, create deals or invent a last-contact touch.

Preview writes nothing. Commit rechecks the reviewed exact identifiers and
target revisions at the guarded receipt statement, locks existing matches and
targets, and commits all accepted row changes, notes, history, audits and the
receipt in one transaction. A stale review returns `409` with no partial import.
The concurrency point is that receipt snapshot: a manual contact creation that
arrives afterwards may coexist, ordered after the import. Shared identifiers
remain legal; this is not a uniqueness constraint on client email or phone.

A stable request UUID identifies one exact reviewed payload. Retrying it returns
the saved row IDs, added/updated/skipped results and counts without creating
contacts or appending notes again. Reusing the UUID for a changed payload returns
`409 request_conflict`. Mutations are never automatically retried by the adapter;
an unavailable response refreshes shared reads while preserving the review.

### Duplicate review and merge

Duplicate review is advisory. Each page checks at most 100 primary contacts and
returns a bounded pair page with scanned/total coverage, continuation state and
an opaque cursor. An empty page with more coverage remaining says to continue
checking, rather than declaring the whole book clear. Name similarity alone
never proves that two people are the same.

A merge requires two writable, unmerged records in the same owner's book and
brokerage. The review shows both records, their conflicting fields, pending
actions/reminders and the data that will be preserved. Conflicts require explicit
winner choices. Separate contact and transaction permissions remain in force;
linked-transaction counts include only deals the caller may see. Assignment or
merging never grants someone new access to a personal contact book.

The commit locks both parents and their existing child rows, checks the opening
contact revisions and complete private-history fingerprints, then writes a
guarded receipt before moving data. All five relationship references are moved:
`contact_notes`, `contact_needs`, `contact_activities`,
`contact_opportunities` and `transaction_parties`. Existing note tombstones,
need statuses, authors and historical timestamps retain their lifetimes.
Unselected legacy note text becomes append-only notes, with Unicode-safe ordered
chunks where necessary, so choosing a field winner does not discard that text.

At most one pending action or legacy reminder is retained by the reviewed
choice. Unselected structured actions receive cancellation history rather than
being presented as completed. The merge retains the latest recorded outreach
time from the two files; it does not stamp a new touch. A stale parent, child or
history snapshot aborts the whole transaction. Receipt recovery also covers an
identical retry whose winner commits while the second caller is still reviewing
its preflight snapshot.

The source remains an archived tombstone with `merged_into_contact_id` and
`merged_at`; its pending action and reminder mirror are cleared. Ancestor
aliases are flattened to the primary file. Normal lists, search and counts
exclude tombstones; old contact links resolve through a bounded, scoped
canonical chain, including when another merge finishes during the read. Original
audit IDs remain intact and authorized canonical history reads the alias family.

Migration 0018 routes child inserts/reference updates through a locked canonical
lookup on exactly those five tables. An already-authorized child write that
waited for a concurrent merge therefore lands on the primary record, with the
same owner and brokerage enforced at each hop. New stale mutations do not edit
the tombstone. Request receipts are not rerouted, and no global book-version
trigger or ownership expansion is introduced.

CSV values and merge field content are absent from URLs, logs and audit
metadata. Audits and receipts contain IDs, actions, field names and counts only.
Private notes, outcomes and review values remain in their authorized contact
views and render as plain text. Merge fingerprints cover hidden references for
concurrency protection without exposing hidden transaction counts or contents.

### Migration and verification status

`0018_contact_import_merge.sql` is prepared locally. It adds the paired merge
pointer/timestamp, import and merge request receipts, and the five canonical
child-routing triggers. **0015–0018 are still unapplied to live databases.**
Deploying this release requires the pending migrations to be applied through the
reviewed deployment process first. No live migration, build, environment change
or deployment was performed for this local update.

Local verification covers **4,990 counted checks**, plus the unnumbered personal
workspace suite. New coverage includes 51 parser/import PostgreSQL checks, 103
duplicate checks, 74 merge PostgreSQL checks, 29 review UI/state checks and 87
actual-adapter checks using synthetic fetch responses. The complete suite's
groups passed across the initial run, its resumed tail and targeted reruns after
an outdated read-only-POST source assertion and the final UI regressions were
updated. Final TypeScript and whitespace checks passed. Browser verification
uses isolated synthetic samples and is separate from authenticated live-data
certification.

Browser review completed a four-row synthetic import (two added, one updated,
one skipped), including correcting an invalid email and distinguishing two
same-name update targets. Reviewed merge preserved the selected company and
pending action, both client needs, notes, cancellation history and two deal
links, and reduced the visible contact count once. A separate conflict rehearsal
refused a stale merge and showed the newer version with explicit choices kept.
At 320×568, the dialogs fit without horizontal overflow, body scrolling reset
between review steps, fixed actions stayed available and the success Close
action returned to the contact list. No live records were used.

## Initial manual property list — superseded layout

Every contact has one private, manually curated Property list, following Client
needs in the contact file. Enter an exact MLS number, review the returned
property, then explicitly Add to list. This is independent of saved needs and
does not recommend properties or filter by budget, type or status. Lookup uses
exact `ListingId`, including numeric identifiers with leading zeroes. Two
records with the same number produce an ambiguity refusal; no first result is
picked. A changed input invalidates its old preview.

The existing authenticated MLS connection resolves current displayable data.
Saving rechecks the reviewed dataset, durable ListingKey and normalized MLS
number. A changed identity requires a new review. Duplicate adds are idempotent
and do not duplicate references or audit events. The successful form clears for
the next MLS number; an uncertain save keeps its reviewed input for recovery.
There is no automatic outreach, matching, task creation or last-touch change.

Saved cards show current photo, price, status, address, factual specifications,
MLS number and listing-office attribution when provided. Address withholding,
display permission and missing-photo rules use the existing MLS normalizer.
Only dataset, listing identifiers, creator/time and soft-removal state are
stored in `contact_properties`; licensed display fields and media are fetched
afresh on opening or Refresh from MLS. Missing, disconnected and unavailable
results retain their saved MLS reference with a truthful message. There is no
sample fallback in production. A malformed upstream success is a failed read,
not an empty result.

The list is scoped through its parent contact before provider creation or MLS
access. Members can read but cannot look up, add or remove entries. Mutations
lock and recheck the same visible, unmerged parent before atomic child/audit
writes. Removal affects only this contact's list and retains a tombstone; a
property can be added again after review. No property listing is deleted. Audit
metadata contains only contact/property IDs and the action.

Pages default to 12, with a maximum of 24; fresh MLS hydration runs at most four
requests concurrently. The UI accepts only answers for the requested page,
recovers when removing the final item on the last page, and provides retry
feedback for failed page reads. Long values wrap on 320px screens, and controls
remain separate from the listing-detail link.

Contact merges lock and fingerprint all property associations as a sixth child
domain. Shared dataset/ListingKey pairs yield one visible card while retaining
both association rows. Unique entries and previous removal history move to the
primary. Canonical routing protects late child writes, and intervening list
changes invalidate a merge review. The reviewed retained-record count includes
Saved properties.

The contact-scoped API exposes GET/POST `/api/contacts/:id/properties`, POST
`/api/contacts/:id/properties/lookup`, and DELETE
`/api/contacts/:id/properties/:propertyId`. Lookup/add accept only bounded
identifiers (2 KiB body limit); snapshots and arbitrary client fields are
refused. Reads are private/no-store. Lookup is explicitly classified as a
retryable read; add/remove are not retried automatically.

`0019_contact_properties.sql` is prepared locally, including the partial live
identity uniqueness rule and canonical child trigger. Live rollout requires
the pending 0015–0019 migrations. No live migration, data mutation, build,
credential/configuration change, push or deployment was performed.

Verification: **5,236 counted checks**, plus the personal-workspace suite. The
complete dashboard run passed 5,225 checks; final source-binding and UI
regressions subsequently passed their targeted suites (95 backend, 18 view and
88 adapter checks), with TypeScript and whitespace checks passing. Other
coverage includes 29 exact-MLS/provider checks and 90 expanded merge checks.
All 44 isolated preview groups pass. Browser checks used synthetic properties
for exact lookup, reviewed add, old-preview invalidation, missing-number copy,
soft removal/re-add, and 320px layout. Removing the sole item on page 2 of a
13-property list correctly returned to all 12 remaining cards. This is local
verification, not certification against authenticated live MLS data.

## Multiple named property lists — current local update

Property lists now open in their own full-page workspace at `/property-lists`.
The contact file has only New list and View lists launchers; it no longer
hydrates, displays or edits the properties inside its side drawer. Users can
create several named lists for one contact, or standalone lists for personal
research. Opening a list shows its property grid. Add property opens a compact
MLS-number dialog with exact lookup, review and explicit save.

Lists are private to their owner and brokerage, including for admins. A contact
association additionally requires current visibility of that contact. A global
workspace entry is available through More, Contacts and Listings; contact
launchers preserve their selected contact context. Gallery rows expose names,
property counts and an optional contact name, with paginated access to older
lists. Empty lists can be opened. List rename requires the reviewed revision.

Creation uses a UUID request identity and payload hash: an identical retry
recovers its original list, a changed request conflicts, and replay rechecks
current scope. Lookup and property saves retain the exact reviewed MLS source,
ListingKey and MLS number. The same property may belong to different lists;
within one list it remains idempotent. Soft removal affects only the selected
list. No listing snapshots, media or prices are copied into CRM storage.

Migration 0020 backfills the original per-contact property references into
named default lists, keeping their IDs, authors, timestamps and removal states.
A property membership now requires its list ID and carries that list's optional
contact association. Personal lists have no contact. Compatibility endpoints
are restricted to an explicit owner-private default list; contact visibility
alone never admits another user's list. Original default-contact anchors remain
stable after a merge.

Contact merge locks and fingerprints linked lists, including empty/private
lists, before memberships. It transfers contact associations while retaining
list IDs, names, owners and every membership. It never collapses two named lists
or removes the same property from a different list. Only the caller's own
visible list/property counts appear in review. Private references still
participate in the concurrency guard without exposing their details.

The pending migration set is **0015–0020**. This remains local source/preview
work; no live migration, deployment, build, configuration change or push was
performed. The earlier single-list layout above is historical.

Final verification for this update: **5,469/5,469 counted checks passed** in the
complete dashboard run, plus the unnumbered personal-workspace suite. Relevant
coverage includes 58 named-list backend checks, 99 owner-private compatibility
checks, 100 merge checks, 9 actual 0019→0020 backfill checks, 15 workspace view
checks and 137 named-list adapter checks. Final TypeScript and targeted view/
adapter checks passed after the source-availability guard was completed. All
54 isolated preview groups pass.

Browser review created and renamed a personal list, created a third list for
one contact, opened an empty list and saved the same property independently
in two lists. Contact View lists opened a filtered full-page gallery; no
property cards or MLS form remained in the drawer. The 320×568 create and MLS
review dialogs fit without horizontal overflow; Add to list stayed visible and
closed the popup after confirmation. All browser records were synthetic and
reset on reload. Screenshots are saved with the local project handoff.

## Property research — current local update (2026-11-02)

Each saved property has its own private note (up to 5,000 characters), Your
review status and update revision. Review states are To review, Shortlisted
and Ruled out, separate from the MLS listing's status. Notes belong to one
list membership; the same property can have different notes and decisions in
other lists. They render as plain text and are never sent to clients or the
MLS. Cards show a short preview; Edit review opens the complete note/status
popup. Read-only users can open the complete review without mutation controls.

Research saves use a frozen opening revision and an explicit save. A conflict
keeps the draft and loads the current saved note/status for deliberate review.
The user can keep the draft or adopt the saved review before saving against
the new revision. Exact retries with identical already-saved values return
the current record without another write or audit. A single scoped metadata
GET works even when the property is outside the current filter or MLS is
unavailable. Removal optionally carries the reviewed revision so a newer note
is not silently removed.

Copy or move opens a popup with owned destination lists, including personal
and contact-linked lists. It carries the source note/status to the selected
list. Copy retains the source; move soft-removes it only in the same transaction
that creates the destination. A property already in the destination produces
an explicit refusal; neither entry nor its research is overwritten.

Transfers authorize both private list scopes, including linked-contact
visibility. Locks follow sorted contacts → lists → memberships. A guarded
receipt rechecks both current associations, source revision and target absence
before any write. Receipt replay and failure classification reauthorize both
list scopes. Stable request identities recover lost responses without creating
another copy or removal. Changing destination, mode or reviewed revision uses
a new request identity. Notes/status values are absent from receipts and
audits; only IDs, actions and changed field names are retained there.

Notes, review updates and transfers require no MLS call. MLS refreshes do not
change research, and none of these operations creates outreach, tasks or a
last-touch change. Contact merges preserve independent research in every list;
a research change after merge preflight invalidates its guarded snapshot.

Your review filters run in SQL before pagination. Date-added ordering is
stable by original creation time and ID. Price ordering covers all matching
memberships before selecting a page; it never sorts only the visible page. It
reads fresh displayable MLS price fields in batches of up to 40 keys with at
most four calls at once, with no persisted MLS snapshots. Closed properties
use the same displayed sold-price rule as their cards. Unknown, hidden, missing
and old-source prices remain last in either direction. Price ordering is
bounded to 1,000 matching memberships and refuses larger or unavailable reads
honestly; date-added ordering remains available. The UI preserves the loaded
view and offers retry/date recovery on a price-read failure.

The property route now supports metadata GET and research PATCH, plus POST
`/api/property-lists/:listId/properties/:propertyId/transfer`. Query parameters
include validated reviewStatus and sort choices. Property request bodies are bounded
to 32 KiB to support multiline notes. All routes retain owner-only scope,
private/no-store reads and the existing production source gate.

Migration `0021_property_research_transfer.sql` adds research fields, backfills
existing property revisions from their creation time and creates transfer
receipts. The live prerequisite set is now **0015–0021**. No live migration,
build, data mutation, configuration change, push or deployment was performed.

Verification: the full dashboard run passed **5,704 counted checks**, plus the
unnumbered personal-workspace suite. Two final removal-race regressions brought
the current combined total to **5,706**, with the research suite passing 74/74.
Other changed coverage includes 104 merge checks, 100 compatibility checks,
20 fresh/global MLS price-order checks, 24 actual research UI/state checks and
114 adapter checks. TypeScript and whitespace checks pass. All 66 isolated
preview groups pass.

Browser review saved private notes and status, filtered shortlisted properties,
copied to a personal list, refused a duplicate destination, and moved the
copied entry while preserving the original in its other list. The destination
retained the complete note/status. A conflict rehearsal kept the draft and
required explicit comparison with newer saved research. At 320×568, the edit
and transfer popups fit without horizontal overflow and kept actions visible;
an offline MLS entry remained editable and copyable. All browser records were
synthetic, isolated and reset on reload.


## Showing planner — current local update (2026-11-02)

The internal [Showing Planner](./SHOWINGS.md) connects privately saved MLS properties to contact appointments, a full-page agenda and an upcoming-showings card on Home. Confirmed visits support private feedback and an optional original-list review update. The separate follow-up step uses the contact’s existing Next Action editor. See the dedicated document for scope, concurrency and local verification details.

The [Showing Tour map and route planner](./SHOWING_TOURS.md) now groups one
client's scheduled list properties for one New York day. It provides numbered
locations, road-drive estimates, route order suggestions and an optional
automatic first property. Recommendations do not change bookings. The Google
Maps integration is prepared but remains disabled without explicitly configured
keys; the local demo uses clearly labelled illustrative roads and travel times.
