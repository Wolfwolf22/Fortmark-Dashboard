# GC transaction foundation

Local update, 2026-11-02. Migration 0029 remains unapplied live.

Select **GC / General contractor** under Side in New transaction. The form then
asks only for Property address and Client. It sends a dedicated strict request:
`side=gc`, `transactionType=general_contractor`, address and either a client name
or an existing contact reference. Sales prices, commissions, contract dates,
closing dates, notes, parties, deadlines, MLS data and owner overrides are not
accepted on that path. A selected visible/writable contact can be at any client
stage; the server uses the current contact name, without trusting the submitted
name or changing that contact's stage.

The stored file is owned by the current permitted writer. It has the entered
address, one primary client party, null sales/MLS/date fields and no copied
contact email or phone. City and state remain unrecorded rather than defaulting
to Fort Lauderdale or Florida. Creation, its client relation, request receipt
and safe history commit together. Interrupted exact requests recover their
original file, including when the dialog has been closed and reopened.

## Separate blank workspace

Opening the file shows GC / General contractor, Setup pending, Property
information, Client and an intentionally empty Project checklist. It does not
claim 0-of-0 compliance or completed work. The starter template marker is
`gc-blank-v1`; the database seed trigger skips GC, including Admin-configured
sales checklist attachment defaults. No project checklist, workflow, stage or
financial structure is invented before the contractor requirements are defined.

The ordinary sales pipeline, MLS import, tours, vendor assignment, document,
commission and closing-date controls are absent. Existing sales mutation paths
also refuse GC server-side with `gc_not_configured`; hiding controls alone is
not the enforcement. These files remain readable and refreshable while their
future setup is intentionally undefined. Their address/client can be reviewed,
but there is no new general-contractor editing/configuration workflow in this
foundation.

GC files can be found in the existing worklist and side filter. Board view puts
them in a separate GC section, outside the draggable sales stages. Quick preview,
search and linked-contact records say Setup pending. The assistant's read DTO
uses a not-configured lifecycle and omits sales money, dates and milestones.
Live and sample Home/Reports/ROI/production metrics exclude GC from sales totals,
including active/unpriced/untermed counts, deadline attention and leaderboard
figures. An opened GC file can still appear as a correctly labelled activity.

## Migration and verification

The additive release extends the side and type vocabulary by rebuilding the two
PostgreSQL enums inside the existing atomic migration runner. It does not use
non-atomic ALTER TYPE ADD VALUE or weaken migration checks. The migration test
upgrades actual pre-GC tables, preserving every prior transaction field and
checklist row. A newly created ordinary sale still receives twelve pending
starter items; a GC file receives none.

Checks cover strict creation, canonical/visible clients, scope/current-role
changes, receipts/concurrency/rollback, blank fields and children, sales-write
refusal, unchanged sales metrics (including contaminated GC fixtures), sample
adapters, minimal form, responsive workspace, worklist navigation and recovery.
The local preview uses disposable synthetic data; reload resets it. No live
DB migration, provider call or deployment was performed.

Final local checks: 9,049/9,049 numbered regressions and the unnumbered
workspace suite passed; all 205 preview groups passed. Desktop and 320px phone
checks verified two-field GC creation, refresh/reopen, side filtering, separate
board presentation, long-address wrapping and the intentionally empty workspace.
The separate native migration-runner harness skipped because PostgreSQL server
binaries were unavailable; the additive enum/trigger migration itself was tested
inside an isolated PostgreSQL engine, including pre-existing row preservation.
