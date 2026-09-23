# FortMark Dashboard — Core V1 Completion

**Phase:** Core product completion — dashboard first, AI second.
**Date:** 2026-09-22 → 2026-09-23 · **Branch:** `claude/dashboard-status-yir55p` · **Preview:** `2d80e68` → `308e549`

**Status: CORE V1 = COMPLETE IN PREVIEW, redefined** (2026-09-23). Core V1 now
includes automatic agent MLS identity: professional licence → MLS member →
FortMark office → My Listings (§11). It is certified live on Preview.

**Not Production-ready until re-audited.** Production was paused at Deploy A
(`c4e304b`, migrations 0000–0009, MLS off); Deploy B was not started. Migration
`0010` and everything in §11 exist on Preview only. The next step is to re-run
the Core V1 Production promotion audit with §11 in scope.

---

## 1. Baseline audit (repository + runtime truth)

| Domain | State | Backing source | Notes |
|---|---|---|---|
| Authentication | REAL | Clerk + fail-closed allowlist | Unchanged. |
| Professional profile | REAL | `professional_profiles`, `profile_images` | Onboarding, editor, photo, business card. |
| Professional licensing | REAL (self-reported) | `license_state/type/number/expiration`, `nrds_number` columns — already first-class | Labelled "Self-reported. FortMark does not verify licence details." No authoritative verification exists (DBPR not integrated), and none is claimed. |
| Team / agents | REAL (this phase) | `dashboard_users` + profiles via `/api/team` | Was a generated roster. Role changes and invitations: NOT IMPLEMENTED (and no longer pretended). |
| Brokerage identity | NOT CONFIGURED at baseline → REAL (Preview, §9) | `brokerage_identities` | Settings › Brokerage refused the generated brokerage. Now a real, operator-provided record. |
| Listings / MLS search | NOT CONFIGURED (code complete) | Bridge RESO `miamire` | The dashboard project has no Bridge credential in any environment. |
| Listing detail / media | NOT CONFIGURED (code complete) | Bridge `Property` + embedded `Media` | Media defect fixed this phase (§4). |
| Comparables | NOT CONFIGURED (code complete) | Bridge closed sales | Upstream verified working (254 closed SFR, Sunrise, 6 mo). |
| Contacts | REAL | `contacts` + activities | Production live since Stage 1. |
| Opportunities | PARTIAL | `contact_opportunities` (stored with a contact) | No dedicated view; O1 frozen by product priority. |
| Transactions | REAL | `transactions` + parties/deadlines/events | Production live. |
| Home metrics | REAL | metrics service over contacts/transactions | `real-only`; zeros are real zeros. |
| Search (⌘K) | REAL for contacts/transactions | search service | Listing provider built; activates with the MLS credential. |
| Reports, Calendar, Documents, Messages, Notifications, Market activity, Integrations | NOT IMPLEMENTED | — | Honest `not_configured` states, verified by the zero-data sweep (no invented money, names, files, appointments). |
| Settings | PARTIAL at baseline → COMPLETE for Core V1 (§9) | Profile, Team, Brokerage real; Notifications/Integrations truthfully not configured | |
| AI | REAL on Preview; DISABLED in Production | OpenAI `gpt-5.5`, 9 read tools | Frozen. No change in this phase. |

No domain is in MOCK in normal mode. Fixture data exists only behind the explicit
`SAMPLE_DASHBOARD_ENABLED` / `SAMPLE_LISTINGS_ENABLED` flags, labelled on screen.

### Implementation order used
1. Migration runner (infrastructure prerequisite for any schema work).
2. P0 — licence rules + real Team (no schema change needed).
3. P1–P3 — listings: credential investigation, architecture, FortMark book, media, IDX, Home.
4. P4 — brokerage identity: audited, minimum defined (§6), then built (§9).
5. AI prominence: audited, no change needed (§7).

---

## 2. Professional identity

**Licence number** was already a first-class, typed, nullable column, editable in
Profile and onboarding, shown on the business card and Home identity card. Added:

- A format rule (`lib/profile/normalize.ts`): 2–30 characters, letters and digits,
  with space `.` `/` `-` allowed inside; blank clears; upper-cased and
  space-collapsed. Surfaced per field through the existing 400 path. Existing
  Production data passes (one value, 7 characters, in the allowed set — checked by
  count/length only).
- Still self-reported. No active/expired/disciplinary status is fabricated.

**Team** (`/api/team`, `lib/team/roster.ts`, `lib/team/service.ts`):

- Real `dashboard_users` joined to profile and image; actor resolved from the
  session, never from the request.
- Privileged roles (admin, broker, TC) see every account with status; everyone else
  sees active colleagues only, with no status.
- Fields: name (or "Name not added yet"), role, title, licence (state/type/number,
  labelled self-reported), published contact email (the same choice the business
  card makes), photo. Never: Clerk id, phone, NRDS, MLS agent id, biography, settings.
- Read-only. The fixture roster, with its client-only role and invite controls, survives
  only in labelled sample mode.
- Verified on Preview (e2e): Settings › Team renders the real roster.

---

## 3. Listings — architecture and credential

**Architecture: A — Dashboard → Bridge directly**, server-side, through `lib/mls`.

- The FortMark MCP endpoint is OAuth-only by documented policy (`docs/DEPLOYMENT.md`,
  "MCP boundary"); a dashboard session is not an MCP token, so B would need a new
  service-auth surface on the MCP.
- The dashboard client already exists, is tested (202 MLS checks), and adds no hop.
- **One authority for FortMark's own book:** `getFortmarkListingSummary()` in
  `lib/mls/service.ts` (office id, displayable, active) is the single definition. The
  dashboard Home uses it; the website's Featured Listings should consume it through a
  dashboard API rather than re-implementing the filter. Exposing it publicly is a
  separate decision.
- **Drift control:** the dashboard's field list is verified against the dataset through
  the MCP's `get_fields`, and the office id lives in one pure module
  (`lib/mls/brokerage.ts`). Long term, the two Bridge clients (MCP server and dashboard)
  should share one package.

**Credential status (no values printed)**

| Holder | Credential present | Accepted upstream | Evidence |
|---|---|---|---|
| FortMark MCP server (Bridge, `miamire`) | true | **true** | Live queries 2026-09-22: 2,280 active residential in Fort Lauderdale; Property, Media, Fields and closed-sales queries all answered. The earlier upstream rejection is resolved. |
| Dashboard project (Vercel `fortmark-dashboard`), Preview | **false** (`BRIDGE_API_TOKEN`, `BRIDGE_DATASET`, `MLS_LISTINGS_ENABLED` absent) | n/a | Preview build log: `BRIDGE_API_TOKEN present=false BRIDGE_DATASET present=false`. |
| Dashboard project, Production | **false** | n/a | Env listing (presence only). |

**Human action needed (the only blocker):** in Vercel › `fortmark-dashboard` ›
Environment Variables, **Preview scope first**:

- `BRIDGE_API_TOKEN`: a Bridge server token for dataset `miamire` from FortMark's Bridge account, type Sensitive. A dashboard-specific application token is preferable to reusing the MCP server's.
- `BRIDGE_DATASET` = `miamire`
- `MLS_LISTINGS_ENABLED` = `1`

Then redeploy Preview for live certification. Production follows only through a
separate promotion audit.

---

## 4. Listings — what was built and verified this phase

| Capability | Result |
|---|---|
| FortMark's own listings | `ListOfficeMlsId = FTMK01` ("FortMark, LLC", `ListOfficeKey 445b411d…`) — an id, not a name match. The id filter returns exactly the same six active listings as the name (Pembroke Pines, Coral Springs, Hollywood, Sunrise, and two in Miami, one of them a commercial sale). Listing or co-listing office. Every property type within FortMark's book. |
| Listings page | `MLS search` / `FortMark listings` scope, addressable as `?office=fortmark`. The sample set is never "FortMark's". |
| Photos | **Defect fixed:** in `miamire` the Media resource returns `MediaURL: null`; the URLs live on `Property.Media` (CloudFront `dvvjkgh94f2v6.cloudfront.net`, category Photo, ordered). List, detail and featured now select the embedded collection; results pages carry one thumbnail per row. No stand-in image for a real listing; broken images show an explicit "No photo available" state. The CDN host is allowlisted exactly in `next.config` (optimization unchanged). |
| IDX display rules | Every Property query requires `InternetEntireListingDisplayYN eq true` (count unchanged today: the feed already omits the rest) and the normaliser drops any such record. `InternetAddressDisplayYN = false` (5 of 2,280 active listings in Fort Lauderdale) withholds the address, folio and coordinates. The listing office is attributed on detail ("Listing courtesy of …") and on Home. |
| Detail fields | MLS #, status, price, address, city, type, beds, baths, sqft, lot, list date, DOM, remarks, office, agent name, media. Missing values stay "—". Agent direct phone/email are deliberately not selected. |
| Home | "FortMark listings": active count plus FortMark's highest-priced active listing, from a single request. When there are none: "No active FortMark listings" — never another office's listing. When not configured: the compact MLS status. |
| Search (⌘K) | Existing listing provider; activates with the credential. MLS numbers go to an exact `ListingId` lookup. |
| Comparables | Dashboard path built; upstream verified. Independent of core listings. |
| Performance | Server-side filter, sort, `$top`/`$skip`, `$count`; 12 per page by default, 48 max; one request per page; media carried inline (about 24 rows per listing on detail, trimmed to one on lists). Live latency is unmeasured until the credential exists. |
| Access | Every allowlisted, signed-in user can search the MLS (brokerage-wide data). FortMark-owned records keep their own authorisation. |

**Live certification: BLOCKED** on the dashboard credential. Everything else is
covered offline against a Bridge-faithful stub (202/202), with shapes taken from live
responses.

---

## 5. Migration infrastructure

- **Defect:** `drizzle-orm/neon-http/migrator` sent each statement as its own HTTP
  request (the HTTP driver has no session) and inserted bookkeeping afterwards, so
  it was not atomic.
- **Canonical method now:** `scripts/migrate-core.mjs` `runMigrations()` — one Neon
  WebSocket session (`@neondatabase/serverless` `Client`), drizzle's
  `neon-serverless` migrator (all pending migrations plus their bookkeeping in one
  `BEGIN … COMMIT`), a session advisory lock, and an up-front refusal of DDL that
  Postgres cannot run in a transaction. The same function serves the Preview build
  guard and `npm run db:migrate`.
- **Verification:**
  - `npm run test:migrate` — 19/19 against a real local Postgres through the unmodified Neon driver: fresh apply with drizzle-identical hashes, idempotent re-run, a failed migration and a failed batch leave nothing behind, concurrent runners apply each migration once, non-transactional DDL is refused.
  - Live: Preview build `dpl_9BSj9AwQqncKG6NUm5xLmStcDnrS` logged `migrations applied atomically (bookkeeping rows 9 -> 9, 0 new)` on the real Neon Preview branch.
- Migration 0009 was not created: no schema change was needed this phase.

---

## 6. Brokerage identity (audit; superseded by §9)

- **Real today:** brokerage name "FortMark, LLC" and MLS office id `FTMK01` (from the MLS); the brokerage key `fortmark`.
- **Also available from the MLS office record once the credential exists:** `ListOfficePhone`, `ListOfficeURL`.
- **Minimum for a truthful Settings › Brokerage:**
  - name and MLS office id (known now);
  - office phone and website (MLS);
  - brokerage licence number and office address (owner-entered; needs a small brokerage table — a schema change, now safe with the new runner).
- Logo: the FortMark brand assets.
- No generated brokerage is shown meanwhile.

## 7. AI prominence (audit only)

AI is one navigation item (8th of 9), with no Home widget and no top-bar entry. Home
leads with identity and business state. No change was needed. AI remains frozen:
there were no tool, provider, model or prompt changes.

---

## 8. Core V1 definition and scorecard

**Core V1 =** Auth · Professional profile + licence · Real team · Home daily brief ·
Live MLS listings · FortMark's own listings · Contacts · Transactions · Unified search ·
Truthful settings · Read-only AI as a secondary layer.

| Capability | State | Backing source | Production? | Remaining |
|---|---|---|---|---|
| Auth | COMPLETE | Clerk + allowlist | Yes | — |
| Profile + licence | COMPLETE | profile tables | Yes (Deploy A) | — |
| Role display | COMPLETE (Preview) | `dashboard_users.role` only (§11) | No — Deploy A still shows the Clerk-derived label | Promote |
| Agent MLS identity | COMPLETE (Preview, live-certified) | `mls_member_links` (0010) + Bridge `Member`/`Office` | No | Re-audit; migration 0010; Production credential |
| My listings | COMPLETE (Preview, live-certified) | Bridge, by stored `MemberKey` (listing or co-listing agent) | No | Same |
| Real team | COMPLETE | users + profiles | No (Preview) | Promote; invites/roles later |
| Home daily brief | COMPLETE | metrics service + FortMark MLS summary | Partly (MLS card Preview) | Promote |
| Contacts | COMPLETE | `contacts` | Yes | — |
| Transactions | COMPLETE | `transactions` | Yes | — |
| Unified search | COMPLETE | search service (contacts, transactions, MLS) | Partly | Promote |
| Live MLS listings | COMPLETE (Preview, live-certified 2026-09-23) | Bridge `miamire` | No | Production credential + promotion audit |
| FortMark listings | COMPLETE (Preview) | Bridge; office id from `FORTMARK_MLS_OFFICE_ID` (`FTMK01` in Preview) | No | Same |
| Listing detail / media | COMPLETE (Preview) | Bridge `Property.Media` | No | Same |
| Comparables | CERTIFIED — advanced (Preview) | Bridge closed sales | No | Same |
| Truthful settings | COMPLETE (Preview) | profile + team + `brokerage_identities` | Partly (profile only) | Owner input: brokerage licence #, office address, website |
| Read-only AI | SECONDARY | OpenAI `gpt-5.5` | Disabled | Production key (frozen) |
| Brokerage identity | COMPLETE (Preview); MLS section system-managed since §11 | `brokerage_identities` (0009 + 0010 columns) | Table only (Deploy A) | Re-audit; owner input above |
| Migration runner | COMPLETE | `migrate-core.mjs` | 0009 applied to Production by the operator (9 → 10); 0010 on Preview only (10 → 11) | Use for 0010 in Production |

See `docs/MLS_LIVE_CERTIFICATION.md` for the live evidence.

**Biggest remaining Core V1 gap (superseded):** brokerage identity — built in §9.

---

## 9. Brokerage identity — built (Core V1 final domain)

See `docs/BROKERAGE_IDENTITY.md` for the full model.

> **Revised in §11.** The MLS office id is no longer operator-typed. It is server
> configuration (`FORTMARK_MLS_OFFICE_ID`), and the MLS section of the record is
> synced from the `Office` resource. The matrix below is the history of the
> `942e5b8` model; `e2e/brokerage.spec.ts` now certifies the system-managed one.

- **Schema:** migration `0009_steep_warstar`, additive only. It creates
  `brokerage_identities` with one row per brokerage key (a unique index) and
  SET NULL foreign keys to `dashboard_users`.
  - Applied to Preview only, by the canonical runner in build `dpl_2f7TDznSNzRbucJN7sU6Lrqd7WK9`:
    `migrations applied atomically (bookkeeping rows 9 -> 10, 1 new)` and
    `Core V1 brokerage identity table present`.
  - Production: 9 migrations, no table.
- **Authorisation:**
  - The tenant, role and actor come from the session (`resolveActor`), never from the
    request.
  - Admin and broker edit. Agent, member and transaction coordinator read.
  - The body is strict: a key, id or role in it is a 400.
- **Truthfulness:**
  - The licence is labelled operator-provided and carries no status claims.
  - The MLS office phone and name are shown as a labelled display supplement and never
    stored.
  - Nothing was invented: the licence number, address and website await the owner.
- **Listings:** FortMark's office id is read from the record. With a wrong id the
  FortMark views are empty; with no id they say "not configured". General MLS search is
  independent of the record.
- **Preview seed:** entered through the UI by a privileged certification user:
  "FortMark, LLC", FL, `FTMK01`.

### Live authorisation matrix (Preview `942e5b8`, `e2e/brokerage.spec.ts`)

| Role (set in the Preview DB between runs) | Record | Result |
|---|---|---|
| member | none | read-only empty state; PUT 403; FortMark listings 409 / Home "not configured"; general search OK: 7/7 |
| admin | none → seed | privileged empty state → Configure → saved via UI; validation, injection and office-id matrix; responsive; a11y: 12/12 |
| agent | seed + synthetic foreign row | reads own record, never the foreign one; PUT 403; no edit controls: 7/7 |
| member | same | 7/7 |
| transaction coordinator | same | 7/7 |
| broker | seed | editor path again: 12/12 |

- **Audit:** 1 `brokerage_identity_created` (displayName, licenseState, mlsOfficeId), then
  `…_updated` events naming only `mlsOfficeId`. Refused writes produced no events.
- **Foreign row:** unchanged throughout.

### Regressions on Preview `c4e304b`

- `e2e/mls-live.spec.ts`: 12 passed, 3 skipped. The skips are the input-driven
  restricted-address, photo-count and no-photo checks; their private inputs were not
  re-supplied, and the offline suite covers those rules.
- **Defect L6 (P2), fixed:** the listing detail was 512 px wide at 390 on listings with
  comparables. The Price history / Comparables grid had no mobile column. Fixed, with a
  static check added.
- `e2e/zero-data-sweep.spec.ts`: 8/8. Settings › Brokerage is now truthful rather than
  "not configured".
- One run of each spec hit the known hydration/navigation flake. The re-runs passed, and
  no content assertion failed.

### Could FortMark operate without OpenAI?

**Yes.**
- No Core surface imports the AI layer: only `/api/health` reports its status.
- Production has run Core with AI off since Stage 1.
- Home, Transactions, Listings, Leads, Settings and ⌘K are complete without the
  assistant.

### Navigation

The order is Home, Transactions, Listings, Leads, then Calendar, Documents, Reports,
AI and Messages.
- The four Core destinations lead.
- AI is 8th of 9 and secondary.
- Calendar, Documents and Reports sit before AI while unimplemented. Each says so
  honestly (the zero-data sweep verifies it).
- Grouping or hiding unimplemented domains is a post-V1 navigation choice, not a V1
  defect. Settings is reached from the account menu.

## 10. Core V1 verdict

**CORE V1 = COMPLETE IN PREVIEW** (including §11). Every Core V1 capability in §8 is
COMPLETE or certified on Preview, and AI is a secondary layer. **Not
Production-ready until re-audited.** What remains is:
- owner input: the brokerage licence number, authoritative office address, and website
  if wanted;
- the Core V1 Production promotion audit, re-run with automatic agent MLS identity
  in scope (migration 0010, `FORTMARK_MLS_OFFICE_ID`, the role fix, Deploy B).

## 11. Agent MLS identity and role correction (2026-09-23)

FortMark Dashboard is FortMark-only, not a multi-brokerage CRM. See
`docs/MLS_AGENT_IDENTITY.md` for the model and `docs/BROKERAGE_IDENTITY.md` for the
revised brokerage record.

### Role display (bug)

- **Symptom:** a Production admin was shown as "Member".
- **Root cause:** `getSession()` derived the displayed role from the Clerk org role
  or `publicMetadata.fortmarkRole`, falling back to "Member". Authorisation already
  used `dashboard_users.role`, so the badge and the permissions could disagree.
- **Fix:** every surface (session, Profile, Team) now labels
  `dashboard_users.role` through one table (`ROLE_DISPLAY`). Clerk is only a
  fallback when no dashboard user row exists.

### What was built

- **Migration `0010_flaky_toad`** (additive):
  - the `mls_member_links` table, with a status CHECK;
  - four system-managed MLS columns on `brokerage_identities`.
- **Resolution:**
  - licence → `Member` (by `MemberStateLicense`, with and without the `SL`/`BK`
    prefix) → office check against `FORTMARK_MLS_OFFICE_ID`;
  - the result is stored as `linked`, `office_mismatch`, `not_found`, `ambiguous`,
    `conflict` or `unavailable`;
  - it runs after a profile or onboarding save that changes the licence, on a stale
    Profile read, or on explicit refresh;
  - the save always persists first.
- **Scopes:**
  - My listings (stored `MemberKey`, as listing or co-listing agent);
  - FortMark listings (office);
  - MLS search (whole feed);
  - the defaults and the Home card follow the role.
- **Onboarding and Profile:** they ask only for the professional licence. No MLS id,
  office or brokerage is asked for anywhere.
- **Team:** privileged viewers see each member's MLS connection state.

### Live certification (Preview `308e549`, deployment `dpl_3z3BifQnv6vQChnAq47EBQ34Skd4`)

Setup:
- The Preview database was migrated 10 → 11 atomically by the build.
- The certification user was switched between roles in the Preview database.
- A real FortMark member licence was supplied on the command line only. It is not
  recorded here or anywhere in the repository.

| Spec / phase | Result | What it proved |
|---|---|---|
| `agent-identity` · agent | 8/8 | Role shows Agent. The licence, typed with `SL`, linked to "FortMark, LLC". My listings: 5 active (1 primary, 4 co-listing), all FortMark, no member keys in the payload, a subset of FortMark's 6. Home and the Listings default open on My listings. A wrong licence → `not_found` → My listings 409, never "0"; another state → `not_found`; cleared → `no_license`; restored → `linked`. An agent cannot refresh another user or sync the brokerage. |
| `agent-identity` · admin | 10/10 | Role shows Admin (Profile and Team). `memberMlsId` is visible to admin only. Brokerage MLS section synced (`FTMK01`, "FortMark, LLC"); a PUT carrying `mlsOfficeId` → 400; manual sync 200. A second account with the same licence → `conflict`, and the first keeps its link. An unknown target → 404. Team shows "Connected". |
| `brokerage` · editor | 10/10 | Operator fields only; the MLS office cannot be typed. |
| `brokerage` · empty-readonly (member, record deleted) | 7/7 | The system recreated the record from the MLS `Office` record, with no operator action. |
| `mls-live` | 12 passed, 3 skipped (input-driven) | Search, filters, detail, compliance and bundle checks unchanged. The FortMark and Home assertions were made role-aware. |
| `zero-data-sweep` | 8/8 | No regressions. |

Certified offline only (stub roster, `npm run test:mls-identity`):
- `office_mismatch`, `ambiguous` and `unavailable`. No live FortMark licence produces
  them.
- A Bridge outage during resolution.

**Cleanup (Preview):**
- The synthetic conflict account and its rows were deleted.
- The certification user's MLS link and licence were cleared. Its role is back to
  `member`.
- No Preview profile holds a real licence.
- The system-created FortMark brokerage record is kept, because it is system-managed.

### Production impact

None. Production is unchanged since Deploy A. It has no 0010, no
`FORTMARK_MLS_OFFICE_ID`, no Bridge credential, and MLS is off.
