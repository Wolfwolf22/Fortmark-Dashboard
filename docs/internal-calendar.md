# Internal calendar and daily agenda

The calendar is a read projection of existing FortMark records. CRM appointments remain projections of their original records. Personal calendar items, color labels and per-user label assignments are stored separately; there is no copied MLS listing, third-party calendar account or background route request.

## Sources and scope

- Personal calendar items: privately owned meetings, appointments and reminders. Admin access does not broaden another user’s personal calendar. All-day items are single dates; timed items can span midnight. A timed item can reserve time or remain nonblocking.
- Scheduled showings: the current owner’s appointments with a readable contact. Tour memberships link back to the saved plan.
- Saved tour plans: the current owner’s nonarchived plans with a readable contact. The plan start is a nonblocking marker; booked showing stops remain the actual appointments.
- Client next actions: pending actions assigned to the current user on readable, active contacts. Assignment alone never grants access to a contact.
- Legacy follow-up reminders: the current user’s active contacts with a reminder and no pending structured next action. The legacy mirror does not produce a duplicate calendar item.
- Transaction deadlines: incomplete, nonremoved deadlines on visible, nonterminal real-estate files. General contractor files remain blank until their workflow is configured. A parent closing date is shown as a read-only marker only when no nonremoved closing deadline represents it.

The range uses New York calendar days, with an exclusive `toDay`. The maximum range is 93 calendar days. Queries cap each selected source at 200 rows and return visible totals, truncation and independent availability. An unavailable or truncated source is not an empty or conflict-free schedule.

## Time and planning

`America/New_York` is the existing application business timezone. Date-only deadlines and reminders stay date-only. Appointments retain their real instants, including overnight appointments and 23/25-hour daylight-saving days. Untimed tasks and tour starts have no fabricated duration. Personal timed items reserve availability only when their owner selects Blocks my time; all-day entries do not invent appointment hours.

Overlap warnings use half-open intervals for scheduled showings and personal items that reserve time. Personal overlap warnings are advisory and do not prevent saving the item. A separate adjustable planning buffer warns about short gaps, including back-to-back appointments. It is advisory and is not a drive-time estimate. Use the tour planner’s explicit route calculation for driving recommendations. Source filters limit the warnings to the displayed records.

## Editing

Showing times, client next-action times and transaction deadline dates can be rescheduled from item details. The server loads the original source, preserves its other fields and dispatches to its existing mutation service. Original source permissions, revisions, lifecycle rules, overlap checks, deadline/closing reconciliation and request receipts still apply.

Tour plan edits and legacy reminders open their original workspace. Moving one showing does not move a whole tour; review the saved tour again before scheduling changes. Unknown write outcomes require explicit review. Next actions have revision protection but no idempotent request receipt, so they must not be retried blindly.

The New menu’s Calendar item action and Calendar’s Add item button open the personal item editor. CRM appointments still use their original source workflows. Google/Outlook synchronization and notifications remain deferred.

## Personal items and color labels

Personal items support a title, private notes, location, a New York date, all-day or explicit start/end times, an availability-blocking choice and an optional named color label. Timed spans are limited to seven days. Create, edit and cancel use request receipts and revision checks. Cancelled records stay available to their owner for safe outcome review, and do not appear as active calendar items.

Each user starts with virtual Urgent, Important, Low priority and Personal labels. Reading the calendar does not write those defaults. Users can create and rename labels, choose from eight color palettes, or archive a label. Existing assignments keep archived label names and colors. Names remain visible alongside accents; urgency is never communicated by color alone.

Any visible calendar item can receive a private color label. Adding a label to a showing, tour, contact action, reminder or transaction deadline does not change its source record or grant additional access. Label assignments use the original source identity and per-user revision checks. Clearing a label preserves the assignment revision rather than resetting concurrency protection. Personal items keep their label with their own record revision. Assignments match the exact source identity; if a contact merge replaces that identity, apply the label again to the resulting calendar item.

Database migration 0030 adds the private calendar tables. `CALENDAR_DB_ENABLED` independently controls personal items and labels, while the existing Contacts and Transactions flags continue to control CRM source reads. The local preview uses synthetic memory only. No live migration, deployment or provider configuration is performed by this build.

## Verification

Pure date/conflict tests cover New York boundaries, DST gaps and folds, interval boundaries, overnight grouping and explicit planning buffers. Backend tests exercise scoped SQL aggregation and source reschedules. Adapter, rendered-view and closed preview session tests verify the complete local source flow without live credentials.
