# Showing Planner

Local implementation, 2026-11-02. Migration `0022_showings.sql` is prepared;
**0015–0022 remain unapplied to live databases**. This update does not certify
authenticated production access, a live MLS connection or a deployment.

## Agent workflow

Choose **Plan showing** on a saved property. A contact-linked list defaults to
its client; a personal list requires choosing a visible contact. Set the date,
time, duration, meeting details and private planning notes. The showing keeps
the saved property's MLS identity without creating an MLS content snapshot.

The full-page `/showings` agenda holds scheduled, completed and cancelled
appointments, with day/week/upcoming views and existing contact next actions.
Home shows up to three upcoming visits in the next 30 days. Each showing opens
its detail view to edit, reschedule, cancel or record a visit. The schedule is
internal to FortMark; it does not send invitations or synchronize a calendar
provider.

Dates use America/New_York and display the time zone. The local-time conversion
rejects a daylight-saving gap and identifies the earlier occurrence of an
ambiguous fall-back time. Appointments last 15–240 minutes. New or changed
appointment times must be in the future and within 730 days. Two scheduled
showings for the same agent cannot overlap; adjacent appointments are allowed.

After a real visit, explicitly confirm when it happened and save private likes,
concerns and a summary. An optional review decision updates only the original
saved membership's status, preserving its private research note. If the source
has changed or been removed, save feedback without that optional update or
review the source first. Missing MLS display data does not remove the appointment
or prevent recording feedback.

Completed feedback offers **Set follow-up**. This fetches the contact's actual
current action and opens the existing Next Action workspace. It never replaces
an action automatically. Feedback and follow-up are two separate saves, so a
follow-up refusal cannot discard already-saved visit feedback.

## Privacy and consistency

Showings are private to their owner, including when another administrator can
see the linked contact. Every read and write also checks current contact
visibility. Contact assignment never grants appointment access. A source list's
name/link and membership review revision appear only while its current scope
allows them. Property research notes are absent from showing projections.

Mutations carry a frozen update revision and stable request UUID. A concurrent
edit returns a conflict, and an exact retry recovers the saved result rather
than appending activity twice. Changed payloads require a new request identity.
The client never automatically retries a write. Schedule overlap checks are
serialized for the owner and rechecked inside the guarded transaction.

Planning, editing and cancellation never record an outreach touch or modify
the contact's next action. Only an explicitly confirmed real visit adds a
generic Showing completed activity and advances last-contact time to the
latest actual touch. Private feedback and planning text are excluded from
contact history and audit metadata.

Contact merges preserve appointments, including private appointments that the
merging user cannot read. Those hidden rows participate in the history guard
without leaking their counts or content. Canonical routing retains old-contact
link safety; reparented appointments advance their revision so stale editors
must reload.

## Local review

The existing isolated preview serves synthetic appointments and exercises the
production components. Interactive changes live only in memory and reset on
reload. The server uses no live credentials or database writes. Client
presentations remain deferred for a future AI or MCP integration, as recorded
in `PLAN.md`.

Verification passed: **6,100 counted dashboard checks**, plus the unnumbered
personal-workspace suite, and **84 isolated preview groups**. The complete
dashboard run passed; the final expanded showing SQL suite (82 checks), UI
suite (25) and actual-adapter suite (212) passed separately after their last
regressions were added. The showing HTTP boundary has 40 checks; reviewed
contact merges have 139 SQL checks. Final TypeScript and whitespace checks pass.

Browser review exercised linked-list creation, explicit personal-list contact
selection, overlap refusal, successful rescheduling and cancellation, feedback
with unavailable MLS data, an optional original-membership review update, and
the real contact follow-up editor. Home showed the unchanged pending action
until the explicit follow-up save, then the updated purpose and generic visit
activity. At 320×568, the feedback dialog and planner fit without horizontal
overflow, keyboard focus reached the review controls, and the save footer
remained accessible. All browser records were synthetic.
