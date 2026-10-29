# FortMark design preview

This isolated local harness renders the production `AppShell`, `TopBar`, Home
components, widgets and shared controls against synthetic, clearly labelled data.
It does not add a production route or bypass authentication. All fetch calls are
intercepted locally and network writes are rejected. Records and reliability
scenarios are read-only. The explicitly selected Interactive samples scenario
allows a narrow set of changes to synthetic copies in memory only.
The profile and creation dialogs are explicit preview-only placeholders.

Run from the repository using Node 22 or later:

```sh
node tools/design-preview/server.mjs
```

Open `http://127.0.0.1:4173/preview`. The server rebuilds the real component
bundle and Tailwind styles on page reload. Use the existing theme control for
light/dark, Settings for foundations, and browser width for responsive review.
No extra dependencies, accounts or environment secrets are required.

For deterministic phone/tablet/desktop review, open
`http://127.0.0.1:4173/responsive?width=390`. Its same-origin iframe gives the
real app a 320, 390, 768, 1280 or 1440 px viewport without relying on the
browser's viewport override capability.

The preview includes actual Listings index, listing-detail/gallery and
Transactions board/table/drawer components. Sample cases cover one/multiple/no
images, broken MLS media, offer/due diligence/financing/closing preparation,
on-hold and closed deals, and empty or mixed milestone states. Images are local
illustrative SVG plates, not property photographs. The broken-Media MLS case is
synthetic too, and exists solely to verify the neutral no-photo fallback.

The Home totals derive from the same synthetic transaction work list. No live
feed is connected, so the real featured-listing component keeps its honest
unavailable state. Base fixtures never change. This local review does not certify
a deployment, live authorization or a production database connection.

Direct examples:

- `/preview?view=%2Flistings`
- `/preview?view=%2Flistings%2Fsample-coastal`
- `/preview?view=%2Ftransactions`
- `/preview?view=%2Ftransactions%3Fopen%3Dsample-financing`
- `/responsive?width=320&height=568&view=/listings/sample-coastal`

The responsive review offers width and height selectors and Return to top.
Transaction preview controls include a first-request-unavailable scenario;
the real page's Retry action then recovers the sample records.

## Contacts and follow-ups

Contacts now renders the actual list, filters, paging and contact drawer.
Thirty-four synthetic contacts exercise two pages and include due-today, overdue,
upcoming, never-touched, past-client, colleague-owned and labeled sample-fallback
cases. The preview reuses the production pure query evaluator for filters, sorts,
snapshot counts and pagination. Changing filters preserves preview scenarios
within the same section.

Most fixtures intentionally have the stored-record DTO shape (`recordSource:
"db"`) so the real birthday, needs, notes, activity and linked-transaction UI
can be inspected. This does not connect a database or alter production gates:
every name is prefixed Sample and the persistent preview banner states the
current sample mode. `sample-labeled-fallback` retains the
actual sample-source unavailable sections for comparison.

Useful contact routes:

- `/preview?view=%2Fcontacts`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-overdue`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-due-today`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-upcoming`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-quiet`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-labeled-fallback`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-contact-23` (long name and email)
- `/responsive?width=320&height=568&view=/contacts?open=sample-overdue`

Contacts has Records, Empty contact book and First request unavailable preview
scenarios. The unavailable scenario fails the first list request; the actual
Retry control recovers the fixture list. Home contact totals and its attention
queue derive from these same sample contacts and transaction milestones.

## Reliability cases

Stored-shaped contacts have a fixed synthetic `updatedAt` revision. The labeled
sample-source fallback deliberately has no revision, matching its source mode.

`sample-long-history` contains 137 notes, 143 activity entries and 127 client
needs. All three load in pages of 25. Notes/activity use the application's
`historyPage` helper; needs use its `needHistoryPage` helper with status rank,
updated time and UUID ordering. Tied timestamps and all four need statuses are
included. The activity contains the `contacted` event, and need summaries include
fields that must be readable without editing.

- `/preview?view=%2Fcontacts%3Fopen%3Dsample-long-history`
- `/responsive?width=320&height=568&view=/contacts?open=sample-long-history`

For the explicit conflict rehearsal, select **Remote change on save (409)** in
the preview controls, or open:

`/preview?view=%2Fcontacts%3Fopen%3Dsample-overdue&scenario=conflict`

Open Edit contact, change Company and save. The refused request selects a
predefined newer synthetic read projection and returns 409. Review latest
details then exercises the real editor's draft merge and per-field choices.
The newer sample version changes Company, Email and the revision, so an
untouched field merge is visible too. Neither the original fixture nor the
user's draft is ever written; subsequent saves remain blocked. Reload resets
the rehearsal, and no live records or services are involved.

## Interactive samples

Select **Interactive samples** in the contact preview controls, or open:

- `/preview?view=%2Fcontacts%3Fopen%3Dsample-overdue&scenario=interactive`
- `/responsive?width=390&height=844&view=/contacts?open=sample-overdue&scenario=interactive`
- `/responsive?width=320&height=568&view=/contacts?open=sample-quiet&scenario=interactive`

This mode permits only contact stage changes, structured next actions, client
need creation/content/status changes, and the optional About/named personal-details section. The fixture actor
is explicitly a synthetic Admin. Stage changes use the production transition
graph and optional expected-stage check. About/details use the production schema
and saved revision; need changes use the production schemas and update planner.
Stage or information edits never manufacture a contact touch. Need saves do not
advance the contact revision, matching the production service's contract.

The overdue sample has populated About/details, including wrapping and literal
markup, a populated Other need, and a legacy Other need without descriptions.
The quiet relationship has empty optional information and no structured needs.
Legacy Other status-only edits remain possible; a content edit must describe the
selected Other choices. Hidden Other descriptions clear when their choice changes.

Only local adapter functions can make these allowed changes. Notes, outreach,
legacy date-only reminders, contact identity fields, transactions and every other write remain
blocked. All contacts and needs are copied at module load; no account, browser
storage or remote service receives a sample change. The actual list, filters,
snapshot, drawer and Home counts read the same session state. Need summaries use
the production source-precedence projection, including the case where all needs
are inactive. Data-version updates refresh actual UI hooks.

Navigation retains this mode within the open preview. **Reset samples**, reload,
or changing scenario discards the in-memory changes. Another tab has its own
fresh sample state. Records, conflict, unavailable and long-history cases retain
their original read-only behavior.

Run the isolated sample contract checks with:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-sample-session.mjs
```

These checks cover revision/stage conflicts, optional information save/clear,
Other validation and clearing, legacy status changes, source-precedence summaries,
Home/list/filter agreement, complete long-history paging, blocked writes,
network rejection, unchanged base fixtures and read-only scenario recovery.

## Contact import and duplicate review

The actual Contacts toolbar opens the production CSV import and duplicate-review
dialogs. **Sample CSV** in the preview banner downloads a wholly synthetic file;
its content is also exported as `sampleImportCsv` for deterministic checks.
It includes a new contact, an existing-contact update, a repeated row, an invalid
email and an ambiguous exact match. Both paste and file inputs use the real CSV
parser/mapping controls. Only Interactive samples can commit an import or merge.

The duplicate pair is **Sample Morgan River**, IDs
`60000000-0000-4000-8000-000000000001` and
`60000000-0000-4000-8000-000000000002`. They have different scalar fields, two
pending actions and distinct notes, needs, activity, opportunities and linked
deals. The same-name/email decoy ending `0003` belongs to the colleague's book.
It never appears in this actor's import matches or duplicate suggestions and
cannot be updated or merged across that boundary. The old demonstration
contacts receive unique synthetic phones in read copies to avoid false matches
from their formerly shared example number. Duplicate scanning uses the real
bounded pagination helper and truthful own-book counts.
The older readable sample URLs retain their IDs; import/duplicate review uses
stable synthetic UUID aliases for those records so strict mutation schemas also
work when reviewing an older visual fixture.

Imports normalize through the production pure schema and identify exact matches
and repeated file rows before an explicit add/update/skip choice. Similar-name
advisories do not block adding. Blank update cells keep saved values, and imported
notes append as structured notes. No imported contact receives a real-touch date.
Import requests have in-memory payload receipts, so an identical retry cannot
append notes or create contacts twice; a changed payload under the same request
ID is refused.

Merge review uses the real conflict/default/field-selection and pending-action
helpers. The local commit compares both contact revisions and complete child
fingerprints before moving any record. It retains child IDs, converts an
unselected legacy note into structured notes, records cancellation of unselected
pending actions, and keeps the latest existing touch rather than inventing one.
The archived source points to the keeper and leaves list/Home counts. Opening
the old source ID resolves the canonical contact; direct writes to the retired ID
are refused. Merge receipts prevent repeated transfers and history entries.

The read-only conflict scenario also supports the duplicate pair: the first
refused merge exposes a predefined newer company/version for explicit review.
All subsequent writes remain blocked. Reload/Reset discards imports, merges,
receipts and child transfers. Base fixtures and live services never change.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-import-merge-session.mjs
```

## Structured next actions

The same interactive scenario now supports the real Next action workspace:
schedule, edit, reschedule, complete with an outcome and optional successor, or
cancel with a reason. Completion records a task outcome and never invents an
outreach touch. The old date-only reminder write remains blocked.

The preview uses the production strict mutation schema, event classification,
date eligibility, business-day mirror, status, queue ordering and timeline
projection. Saves compare both the contact revision and pending action ID.
An unchanged set is a no-op. Complete plus successor updates the synthetic
contact and both task history entries in one synchronous local operation.
New or changed times must be future and within 730 business-calendar days;
the exact unchanged due time on an existing overdue action can still be edited.
An exited relationship can resolve its pending action but cannot receive a new
action or successor. Eligible assignees are only the fixture's contact owner and
the existing synthetic Admin reader; assignment never changes contact access.

Useful contact IDs with `scenario=interactive`:

- `sample-due-today`: call at 5pm Eastern (correctly becomes overdue after 5pm).
- `sample-overdue`: email with a past due time.
- `sample-upcoming`: future meeting.
- `sample-quiet`: no action, for scheduling from empty.
- `sample-contact-23`: long purpose and contact name for narrow-screen wrapping.
- `sample-colleague-contact`: distinct owner and Admin assignee options.
- `sample-past-client`: exited relationship with a pending action.
- `sample-contact-01`: legacy date-only reminder for comparison.

Every action and mirrored reminder derive from one due instant. Home and the
contact list use the same shared exact-time classifier, so earlier today can be
overdue with zero calendar days away. Home includes action type, purpose, assignee
and due time. All sample ownership and action assignment IDs are valid synthetic
UUIDs, and the list's Mine filter uses the same fixture actor ID.

The existing **Remote change on save (409)** scenario also supports next actions.
On `sample-overdue`, its first refused next-action save reveals a newer purpose
and time while retaining the action ID. On `sample-upcoming`, it reveals a
replacement action ID. Draft input remains unchanged, and the actual UI requires
explicit review. This scenario remains read-only after review and still supports
its original Company-edit rehearsal. Reload resets both rehearsals.

Run the next-action contract checks separately:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-next-action-session.mjs
```

The checks cover concurrent/stale saves, valid assignees, time boundaries,
no-op/edit/reschedule, complete with and without successor, cancellation, exited
relationships, task history text, Home/list agreement, denied legacy/transport
writes, unchanged drafts on conflict and immutable base fixtures.
