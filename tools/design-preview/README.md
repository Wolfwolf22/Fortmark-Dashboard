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
need creation/content/status changes, manual property references and private
property research/copy/move, import/merge,
and the optional About/named personal-details section. The fixture actor
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

## Named private property lists

The actual `/property-lists` page renders the production list gallery, workspace,
create/rename dialogs and small Add property popup. The contact drawer contains
only New list/View lists launch links. Lists are personal to the fixture owner;
linking a contact is optional and never grants another person access.

`sample-due-today` has **Waterfront options** and **Investment research**. The
fixture actor also has **Personal market research** and empty **Weekend
opportunities** lists with no contact association. A colleague-owned personal
list is deliberately excluded even though the fixture actor is an Admin.

Useful routes, with `scenario=interactive` for local changes:

- `/preview?view=%2Fproperty-lists&scenario=interactive`
- `/preview?view=%2Fproperty-lists%3FcontactId%3Dsample-due-today&scenario=interactive`
- `/preview?view=%2Fproperty-lists%3FcontactId%3Dsample-due-today%26new%3D1&scenario=interactive`
- `/responsive?width=320&height=568&view=%2Fproperty-lists&scenario=interactive`

Seeded list IDs begin `83000000-0000-4000-8000-` and end `000000000001`
(Waterfront), `000000000002` (Investment), `000000000003` (personal research),
`000000000004` (empty personal) and `000000000006` (long history). The long-history
list has thirteen references for 12+1 property-card paging. The existing contact
API targets one original-contact default list for compatibility.

Waterfront contains available **SAMPLE-001** plus retained
**SAMPLE-MISSING-901** and **SAMPLE-OFFLINE-902** references. The banner suggests
**SAMPLE-002** and **SAMPLE-003** for manual lookup/review/add in the popup.
Unknown **SAMPLE-999** gives a no-result response;
**SAMPLE-NOT-CONFIGURED-903** simulates an unconfigured feed. All listing DTOs are
explicitly synthetic, use local illustrations and resolve through the normal
listing-detail component. No fictional input reaches an MLS provider.

The adapters reuse production name/lookup/add/rename schemas and paging rules.
Create receipts prevent duplicate lists on retries. Rename compares its reviewed
revision, and membership changes advance the list revision. Add binds the freshly
resolved dataset and listing ID. Repeated add within one list returns its active
reference; the same property can be saved independently in another list. Removal
is soft and repeatable; re-add creates a new ID while preserving the old row.
No list action invents a contact touch or contact activity.

Contact merge retains every named list ID/name and membership, including removed
references. It changes the optional contact association and keeps same-property
entries in separate lists. List metadata and all membership rows participate in
the merge fingerprint; creating an empty list or changing a membership after
review requires a fresh merge review. Owner-private counts exclude others' lists.
Records/conflict scenarios reject writes; reload/Reset clears all sample changes.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-property-session.mjs
node --experimental-strip-types --no-warnings tools/design-preview/test-named-property-list-session.mjs
```

## Property research, copy/move and list filters

The real workspace now offers notes and To review/Shortlisted/Ruled out status
for each saved membership. The same MLS property in Waterfront and Personal
market research starts with different notes/status. The long-history list
(`83000000-0000-4000-8000-000000000006`) has thirteen mixed-status memberships,
varied fictional prices and one unavailable reference for global sorting checks.
Normal preview notes use ordinary property-research language; markup and boundary
payloads exist only in the isolated regression script.

More actions opens the actual research or copy/move dialog. A metadata-only
single read, research save or transfer works without an MLS lookup. Notes preserve
whitespace/newlines and belong to one membership. A stale differing save returns
409; an exact submitted snapshot already saved is acknowledged without rewriting.
Remove also accepts the reviewed membership revision.

Copy preserves the source and creates independent destination research. Move
soft-removes the source after creating its new destination membership. An already
saved identity in the destination returns `target_has_property`; neither record
is overwritten or removed. Receipts reauthorize the original source/destination
on replay, preserve request identity, and refuse replay after destination removal.
Private colleague-owned targets remain inaccessible even to the sample Admin.

Status filtering and added-date/price ordering apply to the complete scoped list
before pagination. Filter totals and unfiltered totals remain distinct. Unknown
prices stay at the tail, with stable added-date ordering. Membership/list revisions
and content-free audit facts participate in contact merge checks; a copy can
leave its source revision unchanged while still requiring a fresh merge review.
None of these operations manufactures a contact touch or activity feed entry.

For browser stale-research review, choose **Remote research change (409)** in the
preview controls or use `scenario=conflict` on a property-list detail URL. The
first refused save reveals a predefined newer notes/status revision for explicit
review. The original draft is kept, subsequent writes remain blocked, and reload
resets the rehearsal. All interactive research and transfer data remains in memory.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-property-research-session.mjs
```

## Showing planner and confirmed visits

The actual `/showings` agenda, saved-property Plan showing dialog, showing
details and subsequent contact Next action view render in this harness. The
production showing client adapter is used; its source check and requests are
answered by a closed, memory-only transport. No request falls through to a live
service. Interactive samples can create, edit, reschedule, cancel or complete a
synthetic plan. Records remains read-only, and reload resets every session change.

Open `/preview?view=%2Fshowings&scenario=interactive`, or use the responsive
wrapper at `/responsive?width=320&height=568&view=%2Fshowings&scenario=interactive`.
Sample Showing `84000000-0000-4000-8000-000000000001` is scheduled tomorrow at
10:00 New York time. The past unrecorded plan ending `0005` retains its offline
MLS reference and can be completed with an explicit actual visit time. A separate
completed visit and cancelled plan demonstrate their distinct states. Another
owner's showing is seeded but never appears in this actor's private agenda.

Contact pickers and linked defaults project stable synthetic UUID aliases in
property-list/showing routes to satisfy the unchanged production input schema.
The same underlying records retain their readable Contacts links. Schedule
windows, overlap rules, request receipts and revision checks use production pure
contracts. Agenda next actions cover the actor's own contacts regardless of the
action assignee, with independent counts and pagination from showing plans.

Only confirmed completion records one generic Showing completed activity at the
explicit visit time and advances the contact's latest actual interaction. Private
feedback, planning notes, MLS identifiers and meeting instructions never enter
that contact/Home event. Existing next actions and reminders stay unchanged until
the separate follow-up form is saved. Optional source-property status updates
require the reviewed active membership revision and preserve its notes. Missing
or removed property details do not erase a showing or prevent visit recording
without an optional research update. Showing children participate in contact
merge fingerprints and move to the canonical contact while retaining their IDs.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-showing-session.mjs
```

## Read-only showing tours

The **Six-stop sample tour** link in the Showing preview banner opens showing
`84000000-0000-4000-8000-000000000101`. Its source **Saturday tour** list
(`83000000-0000-4000-8000-000000000009`) contains six fictional properties linked
to the same sample contact, with six 45-minute appointments five days ahead in
New York time. The scheduled order deliberately zigzags between their illustrative
locations. The visits are spaced 90 minutes apart so the fixed schedule remains
feasible with a ten-minute buffer. This additional list contributes six actual
rows to the same list/agenda/Home projections, rather than a separate tour mock.

The real tour client adapter reads the isolated GET/POST
`/api/showings/:id/tour` transport. Both are read-only in Records and Interactive
samples: no recommendation writes appointments, history, next actions, research,
receipts or data versions. SHA-256 context tokens use the shared canonical
encoder over the complete authorized source/list/appointment snapshot, independent
of candidate page and display geometry. POST rechecks ownership, contact/day,
membership identity, revisions and fresh displayable locations. Removed sources,
stale reviews and withheld/unresolved stops return controlled errors. Candidate
pages are bounded to 24, selected stops to eight, and multiple appointments for
one membership are explicit and nonselectable.

The map has `kind: sample` and uses local SVG illustrations. The drive matrix is
an explicit asymmetric table of sample road durations/distances, separate from
coordinate drawing; it never estimates driving time from straight-line distance.
The production `optimizeTour` function computes the recommendation. Flexible
ordering reduces the seeded 103-minute driving baseline to 38 minutes. Fixed
appointments preserve their recorded order and times. Returned `resolvedStops`
are the freshly authorized locations used for that recommendation. Sample results
have no live traffic timestamp or fabricated Google road geometry. No map keys,
external tiles, routing requests or live services are used.

Automatic first-stop selection uses the shared optimizer across every permitted
ordering. If the current selected order cannot fit its booked appointment times,
the result omits baseline driving figures and savings rather than showing a
misleading comparison. Opening a later showing still defaults to the earliest
selectable booked visit. Both context reads and calculated results recheck source
scope and the complete fingerprint after resolving their locations/calculation.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-tour-session.mjs
```

## Saved tours and reviewed scheduling

`/showing-tours` renders the actual saved-tour workspace. Open its **Saturday
buyer tour** fixture at `?tour=86000000-0000-4000-8000-000000000001`. It references
the six-property Saturday list and the existing six appointments. A second draft
uses the separate personal research list, a third belongs to another owner and
remains private, and an archived draft demonstrates retained history. These are
session-only synthetic records. Reload resets drafts and schedule changes; no
browser storage, account service or provider content is persisted.

The real saved-tour client adapter uses the isolated `/api/showing-tours`
transport for index/detail/create/edit/archive/review/schedule. Editing stores
only user-authored settings and opaque references. Reopening rebuilds the view
from current synthetic memberships and appointments, without a cached map or
route. CAS revisions and actor-scoped UUID receipts prevent stale replacement
and duplicate operations. Contact merges include saved-tour children in their
fingerprints and reparent references while retaining saved-tour identities.

An explicit schedule review resolves current locations, applies the production
optimizer to sample road matrices, and returns concrete current/proposed/kept
slots. Its HMAC-signed token contains only safe references, times, revisions and
a fingerprint; a deliberately synthetic per-tour key is used only in this
harness. Reviews expire after 15 minutes. Confirm rechecks contact/list ownership,
memberships, existing appointments, the tour revision and all owner-calendar
overlaps before committing every appointment together. Locked appointments keep
their real duration and times. A failed guard writes nothing. An exact committed
request recovers after token expiry without duplicating appointments, provided
the source and contact remain authorized. Planning and scheduling never create
contact touches, overwrite next actions, send invitations or change research.

Sample endpoint examples are **Sample FortMark office**, **Sample client meeting
point**, and **Sample coastal meeting point**. Only these named fictional
addresses resolve. Their explicit asymmetric road vectors and local coordinates
produce A/B pins and driving totals that include the start/end legs. Returning
to start uses the origin address when supplied, or the first property otherwise.
An unrecognized address returns `unresolved_endpoint`; the preview never
geocodes or converts air distance into a driving estimate. Records can calculate
a read-only review, while mutations require Interactive samples.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-saved-tour-session.mjs
```

See [saved tour behavior](../../docs/SAVED_SHOWING_TOURS.md) for persistence and
review semantics.

## Transactions

The actual worklist opens at `/preview?view=%2Ftransactions`. Full files use
`/transactions/:id`, for example
`/preview?view=%2Ftransactions%2Fsample-financing&scenario=interactive`.
Readable aliases include `sample-offer` (missing contract/closing dates and no
deadlines), `sample-financing` (a deadline due today in New York),
`sample-on-hold` and `sample-closed`. The responsive wrapper accepts these same
file routes through its `view` parameter.

Records is read-only. Interactive samples permits transaction creation, details,
stage, deadline and checklist changes in memory; reload resets everything. Worklist, file,
Home totals/attention and linked contact transactions share one synthetic book.
The real transaction and workspace adapters are used without an adapter alias;
their requests terminate in the closed preview transport, with no live fallback.
Raw cents, calendar days, revisions, scoped parties and paged history follow the
production contracts. Stage changes never invent completed deadlines or contact
touches, and missing entered dates remain missing.

Choose **Remote file change (409)**, or use `scenario=conflict`, to refuse the
first save and reveal a newer revision for explicit review. The draft is kept
and further writes remain blocked in that rehearsal. New transaction uses the
real dialog only in Interactive samples. An uncertain save retains its frozen
payload and request ID across closing, reopening or other New menu selections;
checking the same save recovers its result without creating another file.

The 20 transaction groups exercise the real adapters, revision/receipt guards,
atomic refusals, closing/deadline consistency, lifecycle, recovery, privacy and
Home/contact agreement:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-transaction-session.mjs
```

Each existing or newly created file starts with 12 unchecked starter checklist
items. Stage review explains unfinished requirements; forward jumps and resuming
a paused file cannot bypass earlier checkpoints. Checklist completion/reopening
uses the real adapter, parent/item revisions and exact request receipts. It
never completes a deadline or contact touch. The 12 additional checklist groups
cover these rules, current permissions, stale writes, interrupted results and
atomic refusal:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-transaction-checklist-session.mjs
```

The Open stage checklist link keeps its fragment separate from the record ID
and focuses the checklist after navigation.

Transaction setup now provides Admin-only attachment defaults and a synthetic
vendor directory. Files for each checklist item can be required per file,
uploaded through the actual file picker, downloaded and softly removed in
memory. Only synthetic PDF/JPEG/PNG files up to 4 MiB should be used in preview;
no provider receives bytes. Required evidence gates item completion and stage
advancement. Approved vendor dropdowns are scoped by category; retiring an
entry preserves the file's recorded selection. New-file defaults do not rewrite
existing checklist snapshots. Reload resets records, settings and file bytes.

The real setup/workspace adapters exercise 15 additional groups:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-transaction-operations-session.mjs
```

Total isolated preview groups: 226. Live private-file storage configuration is
documented in [TRANSACTION_FILES_AND_VENDORS.md](../../docs/TRANSACTION_FILES_AND_VENDORS.md).


Selected vendors now expose **Full detail** with service/financing records and
private document types. Previous vendor records preserves replaced selections
read-only. Public fixture aliases and new UUID files both use matching detail
ownership IDs. The real vendor-detail adapter exercises 14 further groups:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-vendor-detail-session.mjs
```

These cover exact cents/rates and optional monthly figures, actual multipart
PDF bytes, current/historical generations, interrupted replies and scope checks.
See [vendor detail behavior](../../docs/TRANSACTION_VENDOR_DETAILS.md).


## Connected transaction properties and tours

In an interactive transaction file, use **Link MLS property**, then enter
`SAMPLE-001`, `SAMPLE-002` or `SAMPLE-003`. These fictional listings include
explicit tax/fee examples; `SAMPLE-004` has no photographs. Current provider
fields display separately from stored file terms. `sample-offer` has a real
synthetic contact relation eligible for the Personal research visits tour;
`SAMPLE-TOUR-1` matches one of that tour's saved properties. Link a tour, open
it, then use Related transactions to return. Reload resets all changes.

The real property/tour adapters exercise 16 additional groups:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-transaction-property-session.mjs
```

These verify reviewed MLS identity/imports, tax/photo projection, a fresh price
without changed deal money or Home volume, exact receipts/CAS, linked identity
protection, private reciprocal tours, replacement matches and safe history.
See [MLS and tour behavior](../../docs/TRANSACTION_MLS_AND_TOURS.md).


## GC transaction foundation

Choose New transaction → Side → GC / General contractor. Only the property
address and client are requested. The full GC file contains property/client
information and an intentionally empty project checklist. Its sales workflow
is not configured. GC remains available in side filters and its own board
section, while sales metrics exclude it. No synthetic GC address is pre-seeded;
create one in Interactive samples. Refresh file retains it; reloading resets.

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-gc-transaction-session.mjs
```

The 10 additional groups exercise the actual adapter's minimal request, blank
workspace, receipt/lost-reply recovery, client scope, side filters, refused
sales writes and unchanged Home figures. See [GC behavior](../../docs/GC_TRANSACTIONS.md).


## Internal calendar and daily agenda

The real Calendar page, item details and internal API adapter now read the same
memory-only showings, saved tours, contacts and transaction deadlines as their
source screens. Nothing reaches an external calendar, routing provider or MLS.

- `/preview?view=%2Fcalendar&scenario=interactive` opens Today.
- `/preview?view=%2Fcalendar%3Fview%3Dweek&scenario=interactive` shows the combined week.
- `/responsive?width=320&height=568&view=%2Fcalendar&scenario=interactive` checks the phone layout.
- Choose **First deadline source unavailable** to verify that other sources remain
  visible with an incomplete-availability message; Refresh restores the deadline source.

Day, Week and Month share New York day boundaries. Date-only deadlines remain
all-day, next actions remain points, and tour-plan starts do not duplicate booked
appointment blocks. Source filters scope the visible work and warning checks.
The adjustable planning buffer is advisory; no driving estimate is invented.

Interactive samples permit calendar rescheduling of a showing, client next action
or transaction deadline through its existing source model. Open its source to
verify the saved date in the same session. Reload discards the synthetic changes.
The New menu’s Plan activity chooser uses the production source navigation.

Run the closed-transport regression:

```sh
node --experimental-strip-types --no-warnings tools/design-preview/test-calendar-session.mjs
```

Twenty-one isolated groups cover the actual adapter, private owner scope, mirror
suppression, all-day/point semantics, source filters, three source reschedules,
revision conflicts, owned-Agent writes, exact receipts after completion/removal,
bounded counts and partial sources.
See `docs/internal-calendar.md` for production behavior and deferred provider sync.
