# Internal calendar and daily agenda

The calendar is a read projection of existing FortMark records. There is no calendar event table, copied MLS listing, third-party calendar account, or background route request.

## Sources and scope

- Scheduled showings: the current owner’s appointments with a readable contact. Tour memberships link back to the saved plan.
- Saved tour plans: the current owner’s nonarchived plans with a readable contact. The plan start is a nonblocking marker; booked showing stops remain the actual appointments.
- Client next actions: pending actions assigned to the current user on readable, active contacts. Assignment alone never grants access to a contact.
- Legacy follow-up reminders: the current user’s active contacts with a reminder and no pending structured next action. The legacy mirror does not produce a duplicate calendar item.
- Transaction deadlines: incomplete, nonremoved deadlines on visible, nonterminal real-estate files. General contractor files remain blank until their workflow is configured. A parent closing date is shown as a read-only marker only when no nonremoved closing deadline represents it.

The range uses New York calendar days, with an exclusive `toDay`. The maximum range is 93 calendar days. Queries cap each selected source at 200 rows and return visible totals, truncation and independent availability. An unavailable or truncated source is not an empty or conflict-free schedule.

## Time and planning

`America/New_York` is the existing application business timezone. Date-only deadlines and reminders stay date-only. Appointments retain their real instants, including overnight appointments and 23/25-hour daylight-saving days. Untimed tasks and tour starts have no fabricated duration.

Overlap warnings use half-open appointment intervals. A separate adjustable planning buffer warns about short gaps, including back-to-back appointments. It is advisory and is not a drive-time estimate. Use the tour planner’s explicit route calculation for driving recommendations. Source filters limit the warnings to the displayed records.

## Editing

Showing times, client next-action times and transaction deadline dates can be rescheduled from item details. The server loads the original source, preserves its other fields and dispatches to its existing mutation service. Original source permissions, revisions, lifecycle rules, overlap checks, deadline/closing reconciliation and request receipts still apply.

Tour plan edits and legacy reminders open their original workspace. Moving one showing does not move a whole tour; review the saved tour again before scheduling changes. Unknown write outcomes require explicit review. Next actions have revision protection but no idempotent request receipt, so they must not be retried blindly.

The New menu’s Plan activity chooser directs creation to the source workflow. Google/Outlook synchronization, personal freehand events and notifications are deferred. No deployment, migration or live provider configuration is part of this local build.

## Verification

Pure date/conflict tests cover New York boundaries, DST gaps and folds, interval boundaries, overnight grouping and explicit planning buffers. Backend tests exercise scoped SQL aggregation and source reschedules. Adapter, rendered-view and closed preview session tests verify the complete local source flow without live credentials.
