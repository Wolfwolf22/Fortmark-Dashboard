# Vendor service and financing records

Local implementation, 2026-11-02. Migration 0027 is additive and remains
unapplied live, along with the earlier local overhaul migrations.

After selecting an approved vendor, **Full detail** opens a focused dialog with
Overview and Files. Service roles record service date, scheduled/completed/
cancelled status, cost, invoice/reference and private notes. All fields are
optional; blank money and dates stay unrecorded. Zero is an explicit amount.

Mortgage / financing records additionally hold quote and preapproval dates,
preapproval amount and expiry, loan amount/type, fixed/adjustable classification,
rate and APR separately (up to four decimal places), term in months, rate-lock
expiry, closing costs and cash to close. The monthly breakdown records the
lender's principal/interest, property taxes, home insurance, mortgage insurance,
HOA and other charges. Only entered components are summed, an incomplete
subtotal is labelled, and the lender's entered total is displayed separately.
No mortgage payment, APR, rate, approval or affordability decision is generated.

Files support reports, invoices, preapproval letters, loan estimates, insurance
quotes and other documents. The role-specific form offers appropriate types.
PDF/JPEG/PNG bytes are validated, filenames normalized, uploads bounded at
4 MiB, and each record permits ten active documents. Downloads use the existing
authenticated private-file service. Provider paths, hashes and URLs are never
returned in record DTOs. Document removal is soft and audited.

## Vendor changes and permissions

Each selection generation owns its identity snapshot, entered terms and files.
Selecting the same current vendor retains that record and its original snapshot.
Replacing a vendor, clearing the selection or marking it not needed detaches the
old record. Selecting again creates a blank record, including when the same
vendor is later reselected. **Previous vendor records** keeps earlier records
available, even when no vendor is currently selected. Historical records are
read-only; existing permitted downloads remain available. Directory retirement
does not silently erase current service records or their evidence.

Current transaction scope and actor status/role are rechecked under database
locks. Only permitted writers on active files can edit the current record.
Member readers and terminal files remain read-only. Parent and detail revisions,
immutable request IDs and file hashes protect concurrent changes and interrupted
saves. An exact committed request can recover its result after replacement;
it cannot make a new change to a historical record. Unsaved drafts/files remain
attached to their original record and require explicit review before rebasing.

Safe transaction history records action and changed field names, without
financial values, notes, filenames or vendor contact details. Saving vendor
records does not complete a checklist, deadline or stage, contact a vendor or
send client information anywhere.

## Release configuration and preview

The feature reuses `TRANSACTION_FILES_ENABLED=1` and the dedicated
`TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store.
A store was not provisioned or connected during this local build. Real uploads
remain disabled until that release setup is complete. The public profile-photo
token is never used as a fallback.

Interactive preview uses synthetic vendors and memory-only records/file bytes;
reload resets them. No live database, storage, lender or vendor is called.
SQL/fake-storage, HTTP/multipart, adapter, UI/state and isolated preview checks
cover revisions, replay, lifecycle, privacy and actual download bytes. See the
release notes for the completed suite totals. Live migrations, signed-in
certification, storage activation and deployment remain separate release steps.

Final local verification: 8,286/8,286 numbered checks and the unnumbered
workspace suite passed; all 179 isolated preview groups passed. Desktop and
320px phone checks confirmed service date/cost saves, exact 4.875% rate, optional
monthly amounts, preapproval/report file selection, retained historical records
and a reachable fixed dialog footer. No live services were used.
