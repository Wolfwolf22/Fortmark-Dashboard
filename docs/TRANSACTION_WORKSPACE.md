# Transaction files and manual deadlines

Local update, 2026-11-02. Calendar work remains on hold. Transactions now have
an operational file workspace at `/transactions/[id]`, reached from the
pipeline and table. The shared Home/contact deep-link drawer remains a quick
view with an Open file action.

## Daily work

A file groups its stage, next open deadline, entered dates, contract terms,
private notes, recorded people and a paged change history. Property identity,
transaction type, prices, commission terms, contract date, scheduled closing and
notes can be edited. Responsible ownership and party identities are preserved;
this release does not reassign deals or rewrite legal party snapshots.

Deadlines are entered manually. Add, edit, mark complete, reopen or remove a
recorded milestone. The system does not infer contract terms, calculate legal
periods, generate milestones or mark them complete when a stage advances.
Removing retains the original row internally. Completing a deadline does not
close the deal or log a contact touch.

Changing a scheduled closing updates its single open Closing milestone in the
same transaction. A new Closing milestone updates the scheduled closing date.
Conflicting or completed Closing records require deliberate reconciliation;
completed evidence is never silently moved. Actual closing remains the date
stamped by the lifecycle transition, distinct from a scheduled date.

The allowed stage graph is unchanged: active moves, one-step contingency
reopening, pause/resume and terminal exits follow the existing domain. Closing
is reachable only from Closing prep. Required per-stage checklist items now gate
forward moves and resuming a paused file, as described in
[TRANSACTION_CHECKLISTS.md](TRANSACTION_CHECKLISTS.md). Terminal moves require clear UI review;
closed/exited files remain read-only. Existing historical lifecycle limitations
remain documented in TRANSACTION_STAGE_DOMAIN.md. This build adds no AI stage
writer, document interpretation, message sending or calendar integration.

## Honest dates and status

Entered dates are validated real YYYY-MM-DD calendar days. Operational today,
due-today/overdue status and closing countdowns use America/New_York, including
midnight and daylight-saving boundaries. Display is independent of the viewer's
local timezone. Compatibility ISO fields use noon UTC; the actual entered day
is available in editable details. An absent contract date stays absent instead
of becoming the record creation date. No recorded deadlines means Needs setup,
rather than claiming the file is On track.

The production sample helper also stops inventing commission terms, execution
dates and a schedule of milestones. Only an explicitly entered closing creates
a Closing milestone. Stage moves never complete sample milestones.

## Permissions and reliable changes

Transaction visibility retains its brokerage rules. Privileged brokerage roles
can access the files their role permits; ordinary agents see their own files.
Member access is read-only. Contact links separately require current Contacts
visibility; a transaction party ID is never treated as a contact ID. Party
snapshots belong to the authorized transaction, while inaccessible contact IDs
are omitted from its projection.

Every new write includes a request UUID and the reviewed parent revision.
Deadline edits also compare the child revision. Writes lock their scope and
recheck owner, brokerage, stage, revision and relevant child state inside the
same database transaction as the receipt, data, event and audit. Creates commit
the file, parties, deadlines, linked-contact history and receipt together.
A failed required history write rolls everything back. A stale stage proposal
cannot overwrite a newer stage.

Exact, explicitly retried requests recover their original result after current
permissions are checked. Changed payloads require another request identity;
writes are never automatically retried. Private note text, addresses, prices,
party contacts and deadline text do not enter event/audit metadata. History
exposes only whitelisted actions, changed field names, stages and times.

An interrupted new-file response freezes the original submitted values and
request. Reopening New transaction restores the pending result check. A later
permission or revision refusal does not unlock a second create while that
original result is unknown.

Migration 0024 adds removed_at and transaction_write_requests. Migration 0025
adds versioned checklist snapshots. Migration 0026 adds private evidence and
approved vendor selection; see [TRANSACTION_FILES_AND_VENDORS.md](TRANSACTION_FILES_AND_VENDORS.md).
These remain unapplied live, together
with pending earlier local migrations. No live
provider calls, data changes, deployment or remote push is part of this build.

## Verification

Checks cover real ephemeral PostgreSQL batches and rollback, authorization,
stale revisions, exact retry, current contact links, Closing synchronization,
removed/completed deadline attention, New York calendar boundaries, actual
HTTP/client adapters and UI state. The isolated preview uses synthetic memory
records and the real UI. Reload resets its edits. Test totals and desktop/phone
screenshots are recorded in the task release outputs.

The full local suite completed with 7,886 numbered checks passing, including
the checklist files and vendor update. TypeScript and whitespace checks pass.
The isolated preview suite passes all 165 groups, including 20 transaction,
12 checklist and 15 file/vendor operation groups. Authenticated live end-to-end
certification and a production build/deployment have not been run.

Manual browser review covered a new opportunity with no invented dates or
commission, stage review, deadline completion/addition, private notes, scheduled
closing synchronization, and concurrent-edit draft preservation. The file and
deadline dialog were inspected at 320 and 390 pixel phone widths.

The existing bounded pipeline read remains limited to 200 matching files; this
release labels that scope rather than treating it as a complete brokerage
count. Server-paged work-list aggregation is a follow-up improvement.
