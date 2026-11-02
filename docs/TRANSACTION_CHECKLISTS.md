# Transaction stage checklists

Local update, 2026-11-02. Every stored transaction receives a versioned checklist
snapshot. The operational starter has two required items for each of the six
active stages. It is a starting workflow, not a jurisdiction-specific compliance
rulebook or automated document verification.

## Working a file

The full transaction file groups checklist items by stage, shows required
completion progress, and records the time an authorized user checks an item.
Completing or reopening an item requires confirmation. Deadlines remain separate:
checking work does not complete a deadline, change terms, or move the stage.

Required unfinished items from every stage before the selected destination block
forward movement. A jump from Opportunity to Financing includes the Offer,
Under contract and Due diligence requirements. Closing requires all active-stage
requirements, including Closing prep. Pausing, moving backward and non-closing
exits do not require a forward checklist gate. Resuming a paused file checks all
requirements before its destination. Missing stage snapshots also refuse
advancement. A stage change never silently checks off an item.

Existing files start with every item unchecked, including advanced or historical
files. A past stage is not evidence that a person reviewed the required work.
Terminal files remain read-only. Completed work on active files may be reopened;
the next forward move then sees the outstanding requirement again.

## Persistence and authorization

Migration 0025 backfills existing transactions and creates a transaction-insert
trigger so new files receive the snapshot in the same database transaction as
their creation. This covers legacy writers during rollout too. The parent
records the template version; snapshot rows retain stable template keys, stage,
label, required flag and order, separate from completion state.

Complete/reopen uses parent and item revisions and an exact request UUID.
Authorization, parent scope, item state, changes, receipt and required history
commit together. Completion records the verified actor on the server; the
browser cannot supply a completion identity or time. Safe history records IDs
and action names, without checklist labels or other private content.

Stage gates run on the server inside the stage-write transaction. The browser
also reads the current checklist to explain missing work. A stale browser or a
direct API request cannot bypass the gate. Interrupted saves use the same
explicit receipt-recovery mechanism as the transaction workspace.

## Admin editing later

The admin template editor is intentionally deferred. Brokerage leadership should
approve the actual required items for its transaction types and market before
relying on this workflow for its compliance process. Future template editing
should create another version and explicitly apply changes to existing file
snapshots; it must not rewrite prior completion evidence or mark new work done.
The starter template and its database trigger must be updated together if the
default changes before that editor exists.

## Local preview and release

Interactive preview files have the same checklist and stage rules, with changes
kept only in memory. Reload resets them. The production sample quick preview is
read-only for stages because it has no stored file checklist.

This update remains local. Migration 0025 and the earlier pending migrations have
not been applied live. No remote push or deployment is part of this checkpoint.
Verification results and screenshots accompany the release outputs.

The full local suite passes 7,277 numbered checks, including 72 isolated
PostgreSQL checklist checks, 13 shared-domain checks, 65 file-service checks,
41 HTTP checks, 36 UI checks and 297 adapter checks. The preview suite passes
150 groups, including 12 checklist groups. Manual review covers a blocked
forward move, completing its requirements and successfully advancing, reopening
an item, checklist deep-link focus, a long address/client in the worklist, and
320/390 pixel phone layouts. Signed-in live certification remains unrun.
