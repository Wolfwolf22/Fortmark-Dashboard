# CRM follow-up: reminders, touches and the business day

Status: implemented on the Preview branch. Not promoted to Production.

## The two ideas, kept apart

| | A follow-up | A touch |
|---|---|---|
| What it is | A reminder: "call Jane on Friday" | Something that happened: a call, a showing |
| Stored as | `contacts.next_follow_up_at` | a `contact_activities` row, and `contacts.last_contact_at` |
| Direct control | Schedule / Change / Mark complete | Log a touch |
| Moves last contact | **Never** | Yes |
| Writes an activity | **Never** | Yes |
| Audit event | Yes (who, which field, how) | Yes |

Scheduling a reminder does not say the contact was reached, so it must not
reset the "No touch in 14 days" heuristic, and it must not put a fake call in
the timeline. Logging a touch may *also* set, change or complete the reminder
in the same step ("I called Jane today, call again Friday"); alone it never
clears one, because an attempted call may complete nothing.

| Scenario | Activity | Last contact | Follow-up |
|---|---|---|---|
| A. Schedule only | none | unchanged | set / changed |
| B. Touch, keep | created | moves | unchanged |
| C. Touch + new date | created | moves | changed |
| D. Complete only | none | unchanged | cleared |
| E. Touch + complete | created | moves | cleared |

## Where the rule lives

`lib/contacts/follow-up.ts` is the only place that decides what a follow-up
means. Home's Needs attention (SQL and items), the sample metrics, the Leads
Follow-up column and the drawer all classify through it: `none`, `due_today`,
`overdue` or `future`. Home's SQL uses `followUpDueBy(now)`, the same boundary
written as an instant. `decideFollowUp` is the one schedule / reschedule /
complete / keep decision, shared by the direct control and by "log a touch".
No component compares dates itself.

## The business day

Before this change every "today" was the UTC day. A follow-up for tomorrow read
"Due today" from 8 PM to midnight Eastern (7 PM in winter), and today's read
"Overdue" for the same hours the next day.

There is no per-user, per-brokerage or profile timezone anywhere in the schema
or the session, so the smallest durable rule for Core V1 is one application
business timezone: `BUSINESS_TIME_ZONE = "America/New_York"`
(`lib/metrics/business-day.ts`). FortMark operates in South Florida. When a
brokerage outside Eastern time exists, that constant is the one thing that
becomes a per-brokerage setting.

- A follow-up is a **day** the person chose. It is stored at noon UTC on that
  day, the convention the AI action already used, which is the same calendar
  day in every US timezone. `next_follow_up_at` therefore stays a timestamp
  and **no migration is needed**.
- "Today" is the Eastern calendar day of `now`. The stored instant is reduced
  to its Eastern day and the two days are compared, so the answer never
  depends on the hour it is asked or on the reader's browser timezone.
- Day boundaries are measured from the calendar, not by adding 24 hours: the
  spring-forward day is 23 hours and the fall-back day is 25.
- The date inputs' minimum is the business day, so nobody is offered a day the
  server would call the past.

## API

`POST /api/contacts/{id}/follow-up`

    { "action": "schedule", "day": "YYYY-MM-DD" }     -> 200 { contact, followUp }
    { "action": "complete" }                           -> 200 { contact, followUp }

`followUp` is `scheduled`, `rescheduled`, `completed` or `kept`. A request that
changes nothing (same day; completing when nothing is set) writes nothing.
Bodies that mix both shapes are refused (400).

- 404: outside the caller's scope (another agent's contact, another
  brokerage's, or missing) — identical answers, so nothing leaks.
- 403: visible but read-only (a `member`).
- 400 `invalid_date`: not a real date, in the past, or more than 730 days out.
  The same check applies when a touch carries a `nextFollowUpAt`.

Authorization is the stage change's, in the same order, and is decided before
the date is judged or anything is written.

## Atomicity and audit

The contact update and its audit event commit in one `db.batch` (a real Neon
transaction), as `changeStage` does: there is no state where the follow-up
changed and the audit is missing, or the reverse. The audit event is
`contact_updated` with `{ contactId, field: "nextFollowUpAt", followUp,
mechanism: "direct" }`: *what changed*, never the date, the contact's name or
any contact detail. No `contact_activities` row is written — audit history is
about the system, not about the client.

## Assigned agent (display)

Profile display name, else — for a contact the caller owns — the caller's own
name from the identity provider (fetched lazily), else "Unnamed agent" on the
drawer. Never a raw id or an email.

## Tests

- `scripts/test_follow_up.ts`: the clock and DST edges; the classifier at
  Florida 11:30 PM; a sweep proving Home's SQL bound and the classifier agree
  on every (now, day) pair around each boundary; scenarios A–E and the real
  `changeFollowUp` / `logActivity` against an in-memory database that models
  transactions; authorization with a positive control for every refusal;
  atomicity; audit content; the no-touch clock; structure.
- `e2e/follow-up.spec.ts`: three role phases (member, agent, broker) against
  seeded synthetic rows on Preview, including a browser clock set to
  11:30 PM Eastern.

## Known follow-ons (not done here)

- **Transaction deadlines** cannot be added, edited or completed after
  creation. That is the next transaction-workflow candidate.
- **Metric windows and transaction deadlines** still reason in UTC days
  (`lib/metrics/window.ts`). The same evening off-by-one exists there and
  should move to the business day with its own tests.
- **The AI follow-up action** validates "not in the past" against a UTC day.
  It is disabled in Production; align it before it is enabled.
- **Per-brokerage timezone** when a brokerage outside Eastern time exists.
