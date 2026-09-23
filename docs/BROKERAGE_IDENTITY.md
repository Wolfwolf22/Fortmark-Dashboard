# Brokerage identity

**What it answers:** which licensed brokerage this dashboard represents.
**Introduced:** Core V1 final domain, 2026-09-23 · migration `0009_steep_warstar` ·
Preview only.

## Record

The table is `brokerage_identities`, with one row per `brokerage_key` (unique index
`brokerage_identities_brokerage_key_key`). The key is the server-side
`FORTMARK_BROKERAGE_KEY` (`fortmark`), resolved with the caller's session in
`resolveActor`.

| Field | Column | Rule (shape only) |
|---|---|---|
| Brokerage name | `display_name` | required, 2–120 characters |
| Brokerage licence number | `license_number` | 2–30 letters, digits, `-` or `.` (the same rule as the agent licence); stored upper-case |
| Licence state | `license_state` | a US state code |
| Office address | `address_line1`, `address_line2`, `city`, `state`, `postal_code` | lines ≤ 120; US state; ZIP or ZIP+4 |
| Office phone | `office_phone` | 10-digit US number, stored as E.164 |
| Website | `website` | `http`/`https` only; a bare domain gains `https://`; other schemes (`javascript:`, `data:`, …), embedded credentials and dotless hosts are refused |
| MLS office id | `mls_office_id` | `[A-Z0-9]{2,20}`, as the MLS issues it |

The row also has `created_by_user_id`, `updated_by_user_id` (set null if the user is
deleted), `created_at` and `updated_at`. No logo is stored: there is no safe asset
mechanism for brokerage media yet.

## Source of truth

- **FortMark-owned stored values are authoritative.** Every value is operator-provided.
- **The MLS supplements the display only.** For the configured office id,
  `GET /api/brokerage` returns `mlsOffice {name, phone}`, read from one of that office's
  current displayable listings.
  - Settings shows the MLS phone only when no office phone is stored, labelled
    **"From the MLS"**.
  - The MLS's office name is shown as "Office name in the MLS".
  - Neither is ever written to the record.
- **Nothing is verified.**
  - The licence is labelled "Brokerage licence (operator-provided)".
  - Settings never shows Verified, Active, Expired or In good standing: there is no
    licensing-authority integration.
  - A brokerage licence is never inferred from an agent's licence. Agent licences
    remain "Professional licence", self-reported, on each profile.

## API: `/dashboard/api/brokerage`

| Method | Who | Result |
|---|---|---|
| GET | any signed-in dashboard user | `{identity, canEdit, mlsOffice}`. `identity` is null when the brokerage is not configured. |
| PUT | admin, broker | Upsert keyed on the brokerage key. Answers 201 (created) or 200 (updated). |
| PUT | agent, member, transaction coordinator | 403, answered before the body is validated |

Every response is `private, no-store`.

- The route reads nothing from the request except the session and the body.
- The body schema is `.strict()`: a `brokerageKey`, `id`, `role`, user id or
  timestamp in it is a 400 ("Only brokerage details can be saved here.").
- The response never includes the row id, tenant key or user ids.
- With no database, the route answers `not_configured`. The labelled fixture is used
  only when `SAMPLE_DASHBOARD_ENABLED` is set.

**Audit:** `brokerage_identity_created` / `brokerage_identity_updated` in
`audit_events`, with the actor, a timestamp, and
`safe_metadata {brokerageKey, changedFields}`. Only field names are recorded, never
values.

## Who edits

The editors are admin and broker (`BROKERAGE_EDITOR_ROLES`). Transaction coordinators
are privileged for records, but they do not own the brokerage's legal identity, so
they read it like agents and members. Settings renders Edit, Save and Cancel only for
editors. Read-only users see a plain read view with no disabled controls.

Empty states:
- **Editor:** "Brokerage profile has not been configured." plus **Configure brokerage**.
- **Others:** "Brokerage information is not available."

## MLS office id: FortMark's own listings

The FortMark-scoped listing views read the office id from this record through
`brokerageMlsOfficeId`. There is no hard-coded office id anywhere in the app;
`lib/mls/brokerage.ts` was removed. The affected views are:
- Listings › FortMark listings (`office=fortmark`);
- Home's FortMark listings card (`/api/listings/featured`);
- the `isFortmark` flag.

| Office id | FortMark views |
|---|---|
| set (`FTMK01`) | that office's listings (listing or co-listing office), 6 active on 2026-09-23 |
| wrong (e.g. `ZZZZ99`) | none. The count is 0 and there is no featured row; no other office's listing is shown. |
| missing | Listings answers 409 `fortmark_office_not_configured`. Home says "FortMark's MLS office is not configured. A broker or admin can set it in Settings › Brokerage." No query is sent. |
| could not be read | Listings answers 503 `fortmark_office_unavailable`; Home says so. |

General MLS search, detail, comparables and ⌘K do not depend on this record: they
work with it missing, and nothing is flagged FortMark.

## Preview seed

The Preview seed was entered through the Settings UI by a privileged certification
user, as an operator would:
- name "FortMark, LLC";
- licence state FL;
- MLS office id `FTMK01`;
- every other field null.

The brokerage licence number, office address and website are **not** known and were
not invented. They need the owner's input.

## Tests

- `npm run test:brokerage` (93 checks):
  - validation;
  - `javascript:` and other schemes;
  - refused keys;
  - the edit-role matrix;
  - the audit diff;
  - no ids in the view;
  - static proof that the tenant comes from the actor and that authorisation runs
    before validation;
  - no hard-coded office id.
- `npm run test:mls`: office-id cases (wrong id → nothing; missing id → refused
  before any request; general search independent).
- `npm run test:migrate`: 0009 applies fresh; a second identity for one key is
  refused.
- `e2e/brokerage.spec.ts`: a live, phased authorisation matrix on Preview (see
  `docs/CORE_V1_COMPLETION.md` §9).
