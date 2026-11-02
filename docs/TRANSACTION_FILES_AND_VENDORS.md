# Checklist files and approved transaction vendors

Local update, 2026-11-02. Migration 0026 is additive and remains unapplied live.

## Checklist evidence

Each checklist item can hold PDF, JPEG or PNG files, up to 4 MiB each and ten
active files per item. The server bounds the received body, inspects actual
bytes, normalizes the filename and generates the storage path. Client MIME,
file names and completion claims cannot substitute for uploaded bytes.

An Admin can require a file on an individual active transaction item. Transaction
setup also lets the Admin set defaults for new files by starter template key.
New-file seeding copies those defaults within the transaction insert. Existing
files keep their own requirement; a changed default does not rewrite them.

A required file must be present before an item can be completed. Required-stage
progress uses completion plus active matching attachment metadata. Completion
and stage progression recheck that evidence inside the atomic database write,
with consistent parent, item and attachment locks. A completed item cannot be
newly made file-required without proof, or have required evidence removed, until
it is explicitly reopened. Removal is soft; committed private bytes remain
retained. It does not automatically erase a person's recorded completion.

The user reviews an upload, requirement change or removal before submitting.
Exact request IDs, parent/item revisions and content hashes make interrupted
uploads recoverable without adopting a different file. A failed database commit
only permits orphan cleanup after a known PostgreSQL rollback and confirmation
that neither metadata nor a receipt adopted that exact path. An unknown outcome
keeps bytes until its result can be resolved.

## Private storage

The implementation uses the installed Vercel Blob SDK with private access and a
dedicated server-only token. It never borrows the public profile-photo token.

- `TRANSACTION_FILES_ENABLED=1` explicitly permits new uploads.
- `TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN` must belong to a **private** store.

No store was provisioned and no live storage credentials were activated in this
build. Without configuration, the workspace says uploads are unavailable.
Existing authorized downloads can use the dedicated token while new uploads
are disabled. A private store must be connected during release setup.

Metadata projections omit provider paths, hashes and URLs. Downloads go through
the authenticated transaction route, recheck current file visibility after the
provider read, and use attachment disposition, private/no-store and nosniff
headers. Member and terminal-file readers may download permitted evidence;
their read access never grants upload, removal or requirement-edit access.
The feature records files and human attestations; it does not interpret the
documents or certify their contents.

## Vendor directory and selection

The Admin maintains the brokerage directory: name, company, email, phone,
categories and approval status. Brokers and coordinators do not inherit this
configuration privilege. Ordinary users only receive approved directory choices.
Admin status and active account state are checked in the write transaction.

Transaction roles are Inspector, Mortgage / Financing, Appraiser, Termite / Pest,
Insurance, Title / Escrow, Attorney and Other approved vendor. Each selection
uses a dropdown of approved entries for that category. Not selected and Not
needed remain distinct; there is no free-text vendor bypass.

Saving checks the current file, selection revision, vendor revision, category,
approval, brokerage and actor permissions under locks. The file stores the
reviewed identity snapshot. Later edits or withdrawn approval preserve that
snapshot and flag its current approval status; they do not rewrite history.
A retired vendor cannot be newly selected. Existing terminal files are read-only.

Directory and transaction writes use request receipts and required safe audit
history. Audit metadata contains IDs, roles and changed field names, not vendor
contact information or file names. No vendor is contacted by this feature.

## Verification and preview

The full local suite passes 7,886 numbered checks plus its unnumbered workspace
suite. New coverage includes 76 vendor PostgreSQL checks, 49 vendor HTTP checks,
74 attachment/format/fake-storage checks, 37 attachment HTTP checks, 357 new
adapter checks and 52 UI checks. The isolated preview passes 165 groups.
Independent review covered private storage, upload cleanup, proof gates,
permissions and concurrent approval changes. A late actor-demotion gap in the
vendor assignment path was corrected and regression tested.

The preview uses synthetic vendors and memory-only file bytes. Manual checks
cover Admin default changes, adding/approving/selecting a vendor, required-file
review, actual synthetic PDF upload, authorized download with identical bytes,
and proof-backed completion. Reload resets preview records and files. Signed-in
live certification, live storage activation, database migration and deployment
remain release steps.
