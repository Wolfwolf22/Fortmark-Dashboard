# Brokerage identity

**What it answers:** which licensed brokerage this dashboard represents. It is always
FortMark: one central record, never per user.

**Introduced:** Core V1 · migration `0009_steep_warstar` (table), then
`0010_flaky_toad` (system-managed MLS columns). **Revised 2026-09-23:** the MLS office
moved from an operator-typed field to system configuration and MLS sync.

## Record

The table is `brokerage_identities`, with one row per `brokerage_key` (unique index).
The key is the server-side `FORTMARK_BROKERAGE_KEY` (`fortmark`), resolved with the
caller's session.

| Field | Column | Owner | Rule |
|---|---|---|---|
| Brokerage name | `display_name` | operator (seeded from the MLS office name) | 2–120 characters |
| Brokerage licence number | `license_number` | operator | 2–30 letters, digits, `-` or `.`; stored upper-case; never "verified" |
| Licence state | `license_state` | operator | a US state |
| Legal office address | `address_line1/2`, `city`, `state`, `postal_code` | operator | lines ≤ 120; US state; ZIP or ZIP+4 |
| Preferred office phone | `office_phone` | operator | 10-digit US, E.164 |
| Website | `website` | operator | http/https only |
| MLS office id | `mls_office_id` | **system** | from `FORTMARK_MLS_OFFICE_ID`; never typed |
| MLS office name, phone, key | `mls_office_name`, `mls_office_phone`, `mls_office_key` | **system** | from the `Office` record |
| Last MLS sync | `mls_synced_at` | **system** | — |

## System-managed MLS section

- **Which MLS office is FortMark's** is server configuration: `FORTMARK_MLS_OFFICE_ID`
  (Preview: `FTMK01`). It is not a user input anywhere.
- **The sync** (`syncFortmarkOffice`) reads that office's `Office` record and writes
  only the system-managed columns. If the central record does not exist yet, the sync
  creates it, with the name taken from the MLS. No agent ever has to "configure
  FortMark" for the dashboard to work.
- **When it runs:**
  - on `GET /api/brokerage`, when the MLS section is missing, belongs to another
    office, or is more than 24 h old;
  - after an agent is first linked;
  - on **Refresh from MLS** (`POST /api/brokerage/sync`, admin and broker).
- **Audit:** `brokerage_mls_synced` with the changed field names only.
- **FortMark-scoped listing views** use the configured office id. With no
  configuration they say "not configured" and never fall back to another office.
  General MLS search is independent.

## Operator-owned fields

- Admins and brokers edit the name, brokerage licence, licence state, legal address,
  website and preferred phone.
- `PUT /api/brokerage` is strict. Any MLS field, a brokerage key, an id or a role in
  the body is a 400 ("Only brokerage details can be saved here.").
- The operator save never writes MLS columns, and the MLS sync never writes operator
  columns.
- Agents, members and transaction coordinators read only, with no disabled controls.

## Source labels in Settings › Brokerage

- Brokerage licence: **operator-provided** (no status claim).
- Office address and a stored phone: **FortMark record**.
- MLS office: **synced from MLS**, with a last-synced time.
- Office phone with no stored value: the MLS phone, labelled **From the MLS**, and
  never stored as FortMark's own.

## Still needed from the owner

The brokerage licence number and the authoritative legal office address, plus the
website and preferred phone if wanted. They are never inferred from an agent licence
or the MLS office record.

## Tests

- `npm run test:brokerage` (98 checks) covers:
  - operator-field validation;
  - MLS fields refused from a save;
  - the view shape (no office key);
  - separation of save and sync;
  - the office id coming from configuration.
- `npm run test:mls-identity` covers the office configuration and sync-due rules.
