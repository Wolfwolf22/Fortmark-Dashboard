# FortMark Dashboard — Core V1 Production Promotion Audit

**Type:** audit and plan only. **Nothing was deployed, migrated, configured or merged.**
**Date:** 2026-09-23 · **Auditor branch:** `claude/dashboard-status-yir55p`

**Decision:** **GO FOR CORE V1 PRODUCTION PROMOTION.** It is subject to human
authorisation, and to one external input that gates only the MLS stage: a
Production-specific Bridge token. No secret values appear in this document.

---

## 1. Certified source

| Item | Value |
|---|---|
| Branch | `claude/dashboard-status-yir55p` (clean working tree; local = origin) |
| HEAD | `1f3d96a`. Docs only (`docs/BROKERAGE_IDENTITY.md`, `CORE_V1_COMPLETION.md`, `MLS_LIVE_CERTIFICATION.md`). |
| **CERTIFIED_RUNTIME_REVISION** | **`c4e304b`**. `git diff c4e304b 1f3d96a` touches only `docs/`. |
| Functional commits since Production | `9836cf3` licence rule + real Team · `b415411` FortMark book, photos, IDX rules · `2d80e68` atomic migration runner · `6244813` Team copy · `b5c43f8` live miamire corrections · `14dd7d4` detail overflow (L5) · `942e5b8` brokerage identity + office id from identity · `c4e304b` detail overflow (L6) |
| Test-only commit | `08618ca` (tests plus docs) |
| Docs-only commits | `922d7f9`, `74e56ce`, `8c1240a`, `c506edc`, `4d909b5`, `1f3d96a` |
| Preview serving | `1f3d96a` (runtime-identical to `c4e304b`). Preview DB at migration level 10 (0000–0009). |

**Evidence on the exact runtime tree:**
- `e2e/mls-live.spec.ts`: 12 passed, 3 input-driven skips, on `c4e304b`.
- `e2e/zero-data-sweep.spec.ts`: 8/8 on `c4e304b`.
- `e2e/brokerage.spec.ts` on `1f3d96a` (2026-09-23 audit re-run): read-only (member) 7/7, editor (admin) 12/12.
- The full role matrix (member, admin, agent, member, transaction coordinator, broker) passed on `942e5b8`, whose brokerage code is identical.
- Offline: `npm test` all 14 suites green (MLS 225, brokerage 93, profile 1212, team 30, …); `npm run test:migrate` 21/21.

## 2. Current Production (read-only observation, 2026-09-23 ~03:35Z)

| Item | Value |
|---|---|
| Deployment | `dpl_5LHqLuT3qAYUTcKAtxLE73pncN72`, revision `b4c04d0`. Still the latest Production deployment. |
| Vercel Production branch | `claude/fortmark-dashboard-build-v39u96` at `b4c04d0`, an ancestor of `c4e304b` (fast-forward possible) |
| Health | `{"ok":true,"revision":"b4c04d0","sources":{"transactions":"db","contacts":"db","listings":"not_configured","homeMetrics":"real-only","assistant":{"provider":"openai","model":"gpt-5.5","status":"no_credential"},"actions":"disabled"}}` |
| Neon | project `misty-cherry-08153356`, branch `br-bitter-cake-av7pmzth` (`production/fortmark-professional-profiles`), DB host fingerprint `23deffc7e4e5` (Preview: `d5050eccdd72`) |
| Migrations | 9 bookkeeping rows (0000–0008). **Every hash equals sha256 of the repository file.** 0000–0008 are unchanged since `b4c04d0`. |
| Schema drift | none. Column, constraint, index and enum fingerprints are identical to Preview outside `brokerage_identities`: 175 vs 192 columns, the difference being that table's 17. |
| Data (counts only) | users 1 (`admin`/`active`); profiles 1; images 1; audit events 65; contacts 0; opportunities 0; activities 0; transactions 0 (parties 0, deadlines 0, events 0); prepared actions 0; `brokerage_identities` absent |
| Licence value | the one stored professional licence **already passes** the new rule and is already normalised. No rewrite is needed. |
| Production env (names only) | `CONTACTS_DATABASE_ENABLED`, `TRANSACTIONS_DATABASE_ENABLED`, `PROFILE_DATABASE_ENABLED`, `PROFESSIONAL_PROFILE_UI_ENABLED`, `PROFILE_IMAGE_UPLOAD_ENABLED`, `PROFILE_BLOB_READ_WRITE_TOKEN`, `DATABASE_ACCESS_CONTROL_ENABLED`, `AI_PROVIDER`, Clerk (4), `FORTMARK_ALLOWED_CLERK_USER_IDS`, `NEXT_PUBLIC_APP_URL`, DB/Neon integration set. **Absent:** `BRIDGE_*`, `MLS_LISTINGS_ENABLED`, `SAMPLE_*`, `OPENAI_API_KEY`, `AI_CHAT_PROVIDER_ENABLED`, `AI_ACTIONS_ENABLED`. |

**Drift check (since Stage 1): none.**
- No later Production deployment, no new migration, no Bridge or AI configuration,
  no sample mode.
- Audit events stand at 65, exactly the count recorded after the Stage 1 owner smoke.
- The Production env timestamps are all at or before the Stage 1 promotion
  (2026-09-22 18:20Z).

## 3. Promotion package (functional delta `b4c04d0` → `c4e304b`)

| Area | Change | Runtime files |
|---|---|---|
| Profile / licence | licence number: 2–30 characters, letters/digits plus space, `.`, `/`, `-`; still self-reported | `lib/profile/normalize.ts`, `fields.ts` |
| Team | real roster from `dashboard_users` + profiles; privileged viewers see status; no generated colleagues | `app/api/team`, `lib/team/*`, `components/settings/team-section.tsx`, `lib/data/adapters/team.ts` |
| Brokerage identity | `brokerage_identities` (0009); `/api/brokerage` GET/PUT; Settings › Brokerage; audit events | `lib/brokerage/*`, `app/api/brokerage`, `components/settings/brokerage-section.tsx`, `lib/data/adapters/brokerage.ts`, `lib/db/schema.ts` |
| Listings | IDX display filter; withheld-address sanitiser; embedded `Property.Media`; land and multi-family types; list-date truth; default Active; attribution; office id from brokerage identity (no constant); detail layout fixes L5 and L6 | `lib/mls/*`, `app/api/listings/*`, `app/(app)/listings/*`, `components/listings/*`, `lib/data/listing-sort.ts`, `next.config.ts` (CDN host) |
| Home | FortMark card: count + featured; says "not configured" / "unavailable" when there is no office id | `components/home/widgets/featured-listing.tsx`, `lib/data/adapters/listings.ts` |
| Search (⌘K) | MLS provider (already in `b4c04d0`) now emits sanitised rows; it activates only with Bridge config | `lib/search/service.ts` (unchanged), via `lib/mls` |
| Migration runner | atomic, lock-serialised `migrate-core.mjs`; the build guard is still Preview-only | `scripts/migrate-core.mjs`, `scripts/migrate.mjs` |
| Subsystems | `team`/`brokerage` keys now gate only the labelled fixtures | `lib/subsystems/config.ts` |

**Excluded (verified absent from the delta):** Opportunity O1, AI capability, tool,
action, provider or prompt changes, Calendar, Documents, Messages, Reports,
Notifications, and new providers.

**Hygiene:**
- No tracked screenshots, HARs, logs, storage-state or `.auth` files, and no
  `test-results`/`playwright-report` (all git-ignored).
- No runtime file references `e2e/`, `@clerk/testing` or the certification identity.
- `FTMK01` appears in runtime source only as a schema comment.
- Test infrastructure (`e2e/`, `scripts/test_*`, `scripts/mls-stub.ts`) stays in the
  repository and is not part of the app bundle.

## 4. Migration 0009 — `0009_steep_warstar.sql` (sha256 `d7b6f614ef029216473207be3ee3e59a72b59451c3aedf5e528b51f62eaf4326`)

- **Statements:**
  - `CREATE TABLE "brokerage_identities"` (17 columns; uuid PK with a default;
    `brokerage_key` and `display_name` NOT NULL; every other business field nullable;
    timestamps default `now()`);
  - two `ALTER TABLE "brokerage_identities" ADD CONSTRAINT … FOREIGN KEY → dashboard_users(id) ON DELETE SET NULL`;
  - `CREATE UNIQUE INDEX "brokerage_identities_brokerage_key_key"`.
- **Additive only.** There is no DROP, RENAME, TRUNCATE, DELETE or UPDATE, and no
  ALTER of any existing table or enum.
- **Transaction-safe:** there is no `CONCURRENTLY` or `ADD VALUE`, and
  `assertTransactionSafe` passes.
- The foreign keys point at existing `dashboard_users(id)`. SET NULL means deleting a
  user never deletes the brokerage identity.
- The unique index enforces one record per brokerage. There are no existing rows, so
  there is no collision, no backfill and no rewrite.
- New audit event names (`brokerage_identity_created`/`_updated`) need no schema
  change: `audit_events.event_type` is `text` with no check constraint (verified in
  Production).
- **Backward compatibility with `b4c04d0`:** the old app contains zero references to
  the table. Drizzle selects only declared columns of declared tables, and no existing
  object is touched. **`b4c04d0` keeps working after 0009.**
- **Risk: LOW** — additive, empty, transactional and verified above.

## 5. Migration runner audit

`scripts/migrate-core.mjs` → `runMigrations`:
- one Neon WebSocket session (`Client`), the same driver the Preview build uses;
- `pg_advisory_lock(7214050913)` serialises concurrent runners;
- `drizzle-orm/neon-serverless/migrator` applies every pending migration **and** its
  bookkeeping insert inside one `BEGIN … COMMIT`;
- `assertTransactionSafe` refuses non-transactional DDL before connecting.

`npm run test:migrate` (real Postgres, unmodified driver) passes **21/21**:
- fresh apply with drizzle-identical hashes, including 0009 and its unique key;
- a re-run is a no-op;
- a failed migration or a failed batch leaves zero partial state and no bookkeeping row;
- concurrent runners apply each migration once;
- the lock is released;
- `CONCURRENTLY` and `ADD VALUE` are refused.

Live evidence: Preview build `dpl_2f7TDznSNzRbucJN7sU6Lrqd7WK9` logged
`migrations applied atomically (bookkeeping rows 9 -> 10, 1 new)`.

Drizzle applies migrations whose journal `when` is newer than the last applied one:
0009 is `1790131131105`, and Production's last is `1790092212914` (0008). **Exactly
one** migration is pending.

## 6. Production migration method (canonical — replaces the Stage 1 manual SQL)

Constraints found:
- Production DB variables are Vercel **sensitive** (write-only). No local `vercel env pull` can read them.
- `scripts/migrate.mjs` migrates only when `VERCEL_ENV=preview`. The Production build prints `migrations skipped` and the host fingerprint, by design.

So the canonical path is the repository's own operator command, `npm run db:migrate`
(`node scripts/migrate.mjs --force`, which calls `runMigrations`). It runs **once**
from a checkout of `c4e304b`, with the Production branch's **direct (unpooled)**
connection string taken from the Neon console. It is never pasted into a file, the
shell history or a log.

Execution environment:
- Node 22 (global `WebSocket` present) with outbound WSS to Neon.
- The read-only preflight (step 3) doubles as the connectivity check. If it cannot
  connect from this session, run from the operator workstation. Same commands.

```bash
git fetch origin && git checkout --detach c4e304b && npm ci
unset DATABASE_URL DATABASE_URL_UNPOOLED
# Neon console › misty-cherry-08153356 › branch production/fortmark-professional-profiles
#   (br-bitter-cake-av7pmzth) › Connect › pooled connection OFF › copy
read -rs DATABASE_URL_UNPOOLED && export DATABASE_URL_UNPOOLED

# 1. Target proof — prints a 12-char host fingerprint only. MUST be 23deffc7e4e5, else STOP.
node -e 'const h=new URL(process.env.DATABASE_URL_UNPOOLED).hostname;console.log(require("crypto").createHash("sha256").update(h).digest("hex").slice(0,12))'

# 2. Preflight (read-only, same driver). Expect migrations 9, table_absent true, counts as §2.
node --input-type=module -e '
import { Client } from "@neondatabase/serverless";
const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await c.connect();
const q = async (s) => (await c.query(s)).rows[0];
console.log(await q("select count(*)::int as migrations, max(created_at)::text as last from drizzle.__drizzle_migrations"));
console.log(await q("select to_regclass(\x27public.brokerage_identities\x27) is null as table_absent"));
console.log(await q("select (select count(*) from dashboard_users)::int users,(select count(*) from professional_profiles)::int profiles,(select count(*) from profile_images)::int images,(select count(*) from audit_events)::int audits,(select count(*) from contacts)::int contacts,(select count(*) from transactions)::int txs,(select count(*) from ai_prepared_actions)::int actions"));
await c.end();'

# 3. Canonical migration. Expect: "migrations applied atomically (bookkeeping rows 9 -> 10, 1 new)",
#    "Core V1 brokerage identity table present" and every other table/column check; exit 0.
npm run db:migrate

unset DATABASE_URL_UNPOOLED
```

Post-migration verification (read-only SQL on `br-bitter-cake-av7pmzth`):
- `count(*)` of `drizzle.__drizzle_migrations` = **10**; the last row's hash =
  `d7b6f614…4326` and its `created_at` = `1790131131105`;
- `to_regclass('public.brokerage_identities')` is not null;
- `to_regclass('public.brokerage_identities_brokerage_key_key')` is not null;
- `select count(*) from brokerage_identities` = 0;
- every §2 count unchanged (users 1, profiles 1, images 1, audits 65 plus any owner
  sync events, business tables 0);
- Production health still `b4c04d0` / ok, with the same sources.

**Failure handling:**
- A non-zero exit means the transaction rolled back.
- Re-run the preflight: it must still show 9 migrations and the table absent.
- STOP and investigate. Never hand-apply SQL and never drop objects.

## 7. Database safety point (create at execution, not during audit)

- **Name:** `pre-core-v1-promotion-<YYYYMMDDTHHMMZ>-from-production-fortmark-professional-profiles`,
  the same convention as `br-shy-rice-av1mq9bf`.
- **Source:** `br-bitter-cake-av7pmzth` at the current head. No compute is needed.
- **Record:** branch id, parent LSN and timestamp.
- **Plan limit:** 5 of 10 branches are in use (one archived), so there is room.
- **Restore limits:**
  - Neon branch restore or point-in-time restore is available within the project's
    **6 h history window** (`history_retention_seconds` 21600, free plan).
  - After 6 h, only the named branch remains.
  - A restore discards every write since the restore point, so it is **human decision
    only**. Nothing restores automatically.
  - The older Stage 1 backup `br-shy-rice-av1mq9bf` stays and predates the owner role
    change.

## 8. Brokerage identity in Production

**Known values** (use as-is):
- display name **FortMark, LLC**;
- licence state **FL**;
- MLS office id **FTMK01**.

The MLS office phone is available from Bridge and is shown only as a labelled "From
the MLS" fallback. It is never stored unless the owner types it.

**HUMAN INPUT REQUIRED** (none may be inferred: not from an agent licence, not from
the MLS office address, not from any external site):
- brokerage licence number;
- office street address, city, state and ZIP;
- website (optional);
- office phone (optional; only to override the MLS fallback).

None of these blocks deployment: every field except the name is nullable and renders
as "Not provided".

**Initialisation — recommended: A (schema only; the owner configures through
Settings › Brokerage after deploy).**
- The migration creates no business row, and the repository has no seed convention
  for business data.
- The Production owner is `admin`, so they are an editor. The Configure flow
  (privileged empty state → form → save → audit) is the path certified live on Preview.
- It takes about 2 minutes, happens inside the promotion window before the MLS stage,
  and puts a real, audited `brokerage_identity_created` event (with the owner as
  actor) on record.
- Option B (an operator SQL seed) is not needed. The only surfaces that depend on the
  record are the FortMark Listings view and the Home card, and they say "not
  configured" until then (certified). No hard-coded `FTMK01` fallback exists or should
  return.

## 9. MLS in Production

**Credential:**
- A **Production-specific** Bridge server token for `fortmark-dashboard`.
- Do not copy the Preview token, and do not reuse the MCP server token.
- `BRIDGE_API_TOKEN` must be a Sensitive variable, Production scope only.

**Validation before exposure:** the operator makes one request from their own shell,
server-side, token held only in memory:

```bash
read -rs BRIDGE_TOKEN
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $BRIDGE_TOKEN" \
  'https://api.bridgedataoutput.com/api/v2/OData/miamire/Property?$top=1&$select=ListingKey&$filter=StandardStatus%20eq%20%27Active%27'
unset BRIDGE_TOKEN
```

The expected answer is `200`. On 401 or 403, do not add it to Vercel: MLS stays
`not_configured`, and there is no sample fallback. The first signed-in request after
the MLS deploy (smoke M1) is the in-app confirmation.

**Compliance code in `c4e304b`** (identical to what was live-certified; the only
change since is how the FortMark flag is computed):
- every Property query includes `InternetEntireListingDisplayYN eq true`, and the
  normaliser drops any `false` record;
- `InternetAddressDisplayYN = false` returns "Address withheld by listing broker", with
  no `folioNumber` (parcel) and no latitude/longitude;
- ⌘K hits use the same normaliser;
- attribution comes from the feed's `ListOfficeName` ("Listing courtesy of …");
- photos come from embedded `Property.Media` (CloudFront); a photo-less listing says
  "The MLS has no photos for this listing", with no stand-in image;
- browser responses carry only product `Listing` fields.

**FortMark office filter:**
- The office id is read from `brokerage_identities.mls_office_id` via
  `brokerageMlsOfficeId` and matched on `ListOfficeMlsId`/`CoListOfficeMlsId` by id.
  There is no name matching and no fallback to another office.
- Missing id: 409 `fortmark_office_not_configured`, and the Home card says "not
  configured".
- General search, detail, comparables and ⌘K are independent of the record (certified).

**Caching:** every listings route stays `private, no-store`, with no MLS cache. This
is conservative and deliberate; don't optimise during promotion.

**Performance sanity baseline** (Preview): search 0.4–0.9 s, detail about 0.33 s,
FortMark scope about 0.39 s, comparables about 0.43 s. Flag anything that is
repeatedly more than 3 s; don't tune ahead of time.

**Browser boundary:**
- A canary build of `c4e304b` put unique fake values in every secret.
- **None** of the 10 canaries appeared in any of 93 client chunks, nor did the Bridge
  host or RESO field names.
- The one client occurrence of the *name* `CLERK_SECRET_KEY` is Clerk's library
  listing server env names. Next.js inlines only `NEXT_PUBLIC_*` values.
- The browser → Bridge request count is verified as 0 during smoke M6.

## 10. Environment matrix (dashboard project `prj_5KVjhWtseC2mnPMkMU35D9F40wQV`, Production scope)

| Variable | Scope | Value / state | Timing |
|---|---|---|---|
| `CONTACTS_DATABASE_ENABLED` | Production | `1` (present, unchanged) | — |
| `TRANSACTIONS_DATABASE_ENABLED` | Production | `1` (present, unchanged) | — |
| `PROFILE_DATABASE_ENABLED` / `PROFESSIONAL_PROFILE_UI_ENABLED` / `PROFILE_IMAGE_UPLOAD_ENABLED` | Production | on (unchanged) | — |
| `BRIDGE_API_TOKEN` | Production **only**, Sensitive | `<ADD PRODUCTION SECRET>` | Stage B, after the token check |
| `BRIDGE_DATASET` | Production, Sensitive (as in Preview) | `miamire` | Stage B |
| `MLS_LISTINGS_ENABLED` | Production, Sensitive (as in Preview) | exactly `1` (the parser accepts only `"1"`) | Stage B |
| `BRIDGE_BASE_URL` | — | **absent** (the default is Bridge's OData v2) | — |
| `SAMPLE_LISTINGS_ENABLED` | — | **absent** (hard invariant) | never |
| `SAMPLE_DASHBOARD_ENABLED` | — | **absent** (hard invariant) | never |
| `AI_PROVIDER` | Production | unchanged | — |
| `OPENAI_API_KEY`, `AI_CHAT_PROVIDER_ENABLED`, `AI_ACTIONS_ENABLED` | — | **absent; unchanged** | out of scope |

Environment variables bind at deploy. Adding them changes nothing until a new
deployment is built.

## 11. AI

**Out of scope and unchanged.** Production AI is off (`no_credential`; actions
`disabled`). This promotion does not add, remove or modify any AI variable, key,
model, tool or action flag. Core V1 has no dependency on AI: only `/api/health`
references the AI layer, and only to report its status.

## 12. Rollout sequence (two deployments, one code revision)

The MLS stage is separated from the core deploy, which makes each stop gate
independent and gives a same-code, MLS-off deployment to roll back to in seconds.

| Step | Action | Stop gate |
|---|---|---|
| 0 | Human authorisation; Production Bridge token in hand; brokerage values (optional) | no authorisation → stop |
| 1 | Neon safety branch (§7) | branch `ready` |
| 2 | Canonical migration (§6: fingerprint → preflight → `npm run db:migrate` → verify) | fingerprint ≠ `23deffc7e4e5`, exit ≠ 0, or counts changed → STOP, no deploy |
| 3 | Old app check: Production health still `b4c04d0` ok | not ok → investigate; 0009 is additive, so leave it in place |
| 4 | **Deploy A:** `git push origin c4e304b:claude/fortmark-dashboard-build-v39u96` (fast-forward from `b4c04d0`) | build log must show `(VERCEL_ENV=production)`, fingerprint `23deffc7e4e5`, `migrations skipped — build guard allows preview only` |
| 5 | Health: `revision c4e304b`, contacts/transactions `db`, listings `not_configured`, assistant `no_credential`, actions `disabled` | any other value → Instant Rollback to `dpl_5LHqLuT3qAYUTcKAtxLE73pncN72` |
| 6 | Owner core smoke C1–C8 (§13) | a P0/P1 → Instant Rollback |
| 7 | Owner configures Settings › Brokerage (FortMark, LLC · FL · FTMK01 + any supplied fields) | save fails → leave it, investigate; Listings stays "not configured" |
| 8 | Record the Deploy A deployment id (the **MLS-off rollback target**) | — |
| 9 | Bridge token check (§9) → add the 3 variables (Production only) | not 200 → stop at Core-without-MLS (valid end state) |
| 10 | **Deploy B:** redeploy the Deploy A deployment (same commit) so the env binds | health `listings:"mls"`, revision `c4e304b` |
| 11 | MLS smoke M1–M8 (§13) | a P0 (e.g. private address visible) → Instant Rollback to Deploy A immediately |
| 12 | Monitor for 1 h, then 24 h (§15) | — |

## 13. Smoke (owner session only; no synthetic Production user; no data mutation beyond step 7)

**Core, after Deploy A:**
- C1 Home loads; metrics are real zeros; the FortMark card says the office is not configured.
- C2 Settings › Profile shows the professional profile; the licence is shown as self-reported with no error.
- C3 Settings › Team lists the owner (admin, active) and no generated colleagues.
- C4 Settings › Brokerage shows the privileged empty state and **Configure brokerage**.
- C5 Contacts and C6 Transactions show real empty states.
- C7 ⌘K finds nothing fabricated; listings are reported not configured.
- C8 Calendar, Documents, Messages and Reports say what is missing.

**MLS, after Deploy B:**
- M1 Listings, MLS search: Fort Lauderdale / Active returns thousands of rows, all `source: mls`, attributed.
- M2 FortMark listings (FTMK01): a small count equal to the Home card count; every row flagged FortMark.
- M3 Detail of one **public-address** listing: fields, attribution and photos render.
- M4 ⌘K with an exact MLS number returns one listing hit, which opens its detail.
- M5 Home FortMark card: count and featured listing.
- M6 DevTools Network: no request to `bridgedataoutput.com`; no `Authorization` header on any browser request.
- M7 (optional) comparables on the same listing; a failure there doesn't block the gate.
- M8 (optional, compliance) only if a withheld-address listing is easy to identify through the app: it shows the withheld text. Record nothing about it. Otherwise the Preview certification stands; don't trawl the data for one.

## 14. Rollback

| Problem | Action | Never |
|---|---|---|
| MLS misbehaves (errors, 401/429 storms, a compliance concern) | **Instant Rollback to the Deploy A deployment** (same code, MLS off). Then delete `MLS_LISTINGS_ENABLED` from Production so no later build re-enables it. Listings becomes honestly `not_configured`; Contacts, Transactions, Home metrics, Team and Brokerage are unaffected. | Never set `SAMPLE_LISTINGS_ENABLED`. |
| App defect (Team, Profile, Brokerage, Home, Settings) | Instant Rollback to `dpl_5LHqLuT3qAYUTcKAtxLE73pncN72` (`b4c04d0`). 0009 stays; the old app ignores the table. | Never drop the table, delete identity data or restore the DB during incident response. |
| Migration failure | STOP before any deploy. The transaction rolled back; verify 9 migrations and the table absent; investigate. | Never hand-apply SQL or drop objects. |
| Identity data wrong | Correct it in Settings › Brokerage (audited) or roll back the app. | Never delete rows or drop the table. |
| Data damage (last resort) | Neon restore from the §7 branch or point-in-time restore (6 h). Human decision only. | Never automatic. |

**Critical rollback rule (audit finding RB-1):**
- `b4c04d0` reads `MLS_LISTINGS_ENABLED`/`BRIDGE_*` but has **no** display filter and
  **no** withheld-address sanitiser; those arrived in `b415411`.
- Instant Rollback to the *existing* `dpl_5LHqLuT3qAYUTcKAtxLE73pncN72` is safe: its
  environment was frozen at build, without Bridge.
- **Never rebuild or redeploy `b4c04d0` fresh while Bridge variables exist in
  Production.** If a rebuild of `b4c04d0` is ever needed, delete the Bridge variables
  first.
- After any Instant Rollback, Vercel stops auto-assigning Production to new git builds
  until someone promotes again. Promote deliberately.

## 15. Monitoring (first hour, then 24 h)

- Runtime logs for `/api/listings*`, `/api/brokerage` and `/api/team`: 5xx count, and
  `[mls]`/`[brokerage]` classified errors (Bridge `unauthorized`, `rate_limited`,
  `bad_request`). Logs carry status and resource only, never tokens or payloads.
- Health every 5 minutes on `https://fortmark-dashboard.vercel.app/dashboard/api/health`.
  The portal path requires sign-in.
- Audit events by type (counts only): expect `brokerage_identity_created` once, then
  only owner edits.
- Vercel system mitigations stay **enabled**. Known automation flakiness is not a
  product signal.

## 16. Remaining issues (none P0/P1)

| ID | Sev | Issue | Disposition |
|---|---|---|---|
| RB-1 | operational | `b4c04d0` lacks MLS compliance; unsafe if rebuilt with Bridge variables | rule in §14; Instant Rollback only |
| P3-1 | P3 | `scripts/migrate.mjs` build log says `listings … -> sample data` when unconfigured; runtime truth is `not_configured` | wording only; fix post-promotion |
| P3-2 | P3 | no baths filter; rows with no list date sort first on "newest" (shown "—") | known, documented |
| P3-3 | P3 | a no-op brokerage save still writes a `…_updated` event with an empty `changedFields` | harmless; optional refinement |
| P3-4 | P3 | nav lists unimplemented Calendar/Documents/Reports before AI (each honest) | post-V1 navigation choice |
| P3-5 | P3 | 3 live MLS checks (withheld address, photo counts, no-photo) were skipped in the final re-run for lack of private inputs; certified earlier on Preview and covered offline | accept |

## 17. Go / No-Go

| Condition | State |
|---|---|
| Migration 0009 safe | ✅ additive, empty, transactional, old app compatible |
| Canonical migrator ready | ✅ 21/21; proven on Preview; Production command defined |
| Production Bridge credential obtainable | ⏳ external input, needed only for Stage B; Core can ship without it |
| No secret exposure | ✅ canary build clean |
| Certified code clean | ✅ `c4e304b`; no artifacts |
| Rollback viable | ✅ Instant Rollback targets defined; RB-1 rule |
| Existing Production profile compatible | ✅ licence passes the rule; no rewrite |
| Team compatible | ✅ the owner (admin/active) appears |
| Brokerage authorisation correct | ✅ live matrix |
| Unresolved P0/P1 | ✅ none |
| Human identity fields | ✅ sequenced after deploy (§8) |
| Production drift | ✅ none |

**Decision: GO**, pending human authorisation to execute. Nothing has been executed.

## 18. Operator checklist (copy-ready)

- [ ] Authorisation to execute Core V1 promotion recorded.
- [ ] Production Bridge token obtained (Production-specific; not the Preview or MCP token).
- [ ] (Optional) Brokerage licence #, office address, website, office phone ready.
- [ ] Neon branch `pre-core-v1-promotion-<UTC>-from-production-fortmark-professional-profiles` from `br-bitter-cake-av7pmzth`; id, LSN and time recorded.
- [ ] Checkout `c4e304b`; `npm ci`; connection string read with `read -rs`; fingerprint = `23deffc7e4e5`.
- [ ] Preflight: 9 migrations, table absent, counts as §2.
- [ ] `npm run db:migrate` → `9 -> 10, 1 new`; all checks present; exit 0; `unset` the URL.
- [ ] SQL verify: 10 rows, last hash `d7b6f614…4326`, table and unique index present, 0 rows, counts unchanged.
- [ ] Production health still `b4c04d0` ok.
- [ ] `git push origin c4e304b:claude/fortmark-dashboard-build-v39u96` (fast-forward).
- [ ] Build log: production, fingerprint `23deffc7e4e5`, migrations skipped; READY.
- [ ] Health: `c4e304b`, listings `not_configured`, AI unchanged.
- [ ] Smoke C1–C8.
- [ ] Settings › Brokerage: FortMark, LLC · FL · FTMK01 (+ supplied fields) saved.
- [ ] Record the Deploy A id (MLS-off rollback target).
- [ ] Bridge token `curl` check = 200.
- [ ] Add `BRIDGE_API_TOKEN` (Sensitive), `BRIDGE_DATASET=miamire`, `MLS_LISTINGS_ENABLED=1`, Production scope only; no `SAMPLE_*`.
- [ ] Redeploy the Deploy A deployment → health `listings:"mls"`, revision `c4e304b`.
- [ ] Smoke M1–M6 (M7–M8 optional).
- [ ] Monitor 1 h / 24 h; record results in this document.

## 19. Scope reminders

- **O1:** frozen.
- **AI:** secondary and unchanged.
- **This audit:** no Production migration, no Bridge key, no MLS enablement, no deploy
  and no merge were performed.

---

# CORE V1 PRODUCTION EXECUTION

**Authorised:** 2026-09-23 (two-stage: Core first, MLS second; AI unchanged).
**Runtime revision:** `c4e304b`.

## Pre-change reconfirmation (03:47Z) — matches the audit, no drift

- Production deployment `dpl_5LHqLuT3qAYUTcKAtxLE73pncN72` (`b4c04d0`), the latest Production deployment; Production git branch at `b4c04d0`.
- Health: `{"ok":true,"revision":"b4c04d0","sources":{"transactions":"db","contacts":"db","listings":"not_configured","homeMetrics":"real-only","assistant":{"provider":"openai","model":"gpt-5.5","status":"no_credential"},"actions":"disabled"}}`. This AI state is to be preserved unchanged.
- DB `br-bitter-cake-av7pmzth`: migrations 9; users 1 (`admin`/`active`); profiles 1; images 1; audit events 65; contacts 0; transactions 0; prepared actions 0; `brokerage_identities` absent.
- Certified source `c4e304b`: clean tree, runtime-identical to the audited tree.

## Migration method decision

- This session cannot obtain Production's direct connection string without printing
  it: the Vercel variables are write-only, and the Neon tool returns it into the
  transcript.
- The operator chose to run the canonical `npm run db:migrate` on their own machine,
  with the secret read by `read -rs` (audit §6).
- No SQL is applied by hand.

## Database safety point

- Neon branch **`br-lingering-wave-avznii5k`**
  (`pre-core-v1-promotion-20260923T0350Z-from-production-fortmark-professional-profiles`).
- Parent `br-bitter-cake-av7pmzth` at LSN `0/1E99E98`, parent timestamp 2026-09-23T03:50:13Z.
- No compute; state `ready`; taken at migration level 9.
- Restore only by explicit human approval.

## Migration 0009 (operator-run, canonical runner, 2026-09-23)

- The operator ran `npm run db:migrate` from `c4e304b` on their own machine, with the
  secret held in shell memory (`read -rs`), then removed it.
- Target fingerprint `23deffc7e4e5`; preflight 9 migrations, table absent, counts as
  recorded.
- Result: `migrations applied atomically (bookkeeping rows 9 -> 10, 1 new)` and
  `Core V1 brokerage identity table present`.
- **Independent verification (04:1xZ, read-only):**
  - 10 bookkeeping rows; the last `created_at` is `1790131131105` (0009's journal time);
  - `brokerage_identities` and `brokerage_identities_brokerage_key_key` present;
    0 brokerage rows;
  - users 1 (`admin`/`active`), profiles 1, images 1, audit events 65, contacts 0,
    transactions 0, prepared actions 0: unchanged.
  - **Schema is now identical to certified Preview:** column, constraint, index and
    enum fingerprints are equal, with 192 columns on both.
- **Finding EX-C1 (P3, cosmetic):**
  - Production's 0009 bookkeeping hash is `f4c19419…`, where the repository and
    Preview have `d7b6f614…`. `f4c19419…` is exactly the sha256 of 0009 with CRLF line
    endings: the operator's Windows checkout converted line endings
    (`core.autocrlf`).
  - The executed SQL is equivalent, as the identical schema fingerprints show.
  - Drizzle never compares hashes. It applies a migration only when its journal time
    is newer than the last `created_at`, so 0009 can never be re-applied.
  - No action is needed. Post-promotion recommendation: add `.gitattributes`
    `*.sql text eol=lf` (and a matching journal rule) so operator runs record LF
    hashes. The bookkeeping row was not edited.
- The old app `b4c04d0` stayed healthy on the new schema: health 200, protected APIs
  401 without a session, 0 error/warning log lines.

## Deploy A — Core V1, MLS off (2026-09-23)

- **Pre-deploy env (names only):** no `BRIDGE_*`, `MLS_LISTINGS_ENABLED` or `SAMPLE_*`;
  no `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_CHAT_PROVIDER_ENABLED` or
  `AI_ACTIONS_ENABLED`; `AI_PROVIDER`, `CONTACTS_DATABASE_ENABLED` and
  `TRANSACTIONS_DATABASE_ENABLED` present. The last Production env change is still
  the Stage 1 set (2026-09-22 18:20Z).
- **Git:** `claude/fortmark-dashboard-build-v39u96` fast-forwarded `b4c04d0 → c4e304b`
  at 04:16:36Z (no force).
- **Deploy A:** **`dpl_C1LNWdNA8CEdYTRtoXyXrrghNnH1`**, a fresh Production build of
  `c4e304b`, READY. It serves Production from 04:18:31Z. **Preferred Core V1 / MLS-off
  rollback target.**
- **Build log:**
  - `VERCEL_ENV=production`, fingerprint `23deffc7e4e5`, pooled and unpooled on the
    same branch;
  - contacts and transactions `database`;
  - listings `MLS_LISTINGS_ENABLED=unset BRIDGE_API_TOKEN present=false` (the "sample
    data" wording is P3-1; runtime is `not_configured`);
  - assistant `not connected` (unchanged);
  - `migrations skipped — build guard allows preview only`.
- **Health:** `{"ok":true,"revision":"c4e304b","sources":{"transactions":"db","contacts":"db","listings":"not_configured","homeMetrics":"real-only","assistant":{"provider":"openai","model":"gpt-5.5","status":"no_credential"},"actions":"disabled"}}`.
  The AI and actions state is identical to before the rollout.
- **Unauthenticated checks:**
  - 401 without a session for `/api/brokerage` (GET and PUT), `/team`, `/profile`,
    `/listings`, `/listings/featured`, `/listings/source`, `/search`, `/subsystems`,
    `/contacts`, `/transactions`, `/metrics`, `/chat` and `/ai/actions`;
  - portal `/dashboard`, `/dashboard/settings` and `/dashboard/listings` redirect
    (307) to sign-in;
  - health is `cache-control: no-store`.
- **Deployed-bundle scan:**
  - 54 of the 93 client chunks from a local `c4e304b` build are served byte-identical
    by Production (content-hashed names);
  - none contains the Bridge host, `BRIDGE_API_TOKEN`, a Postgres URL, `neon.tech`,
    Clerk/OpenAI/Anthropic key prefixes, Blob token prefixes, `ListOfficeMlsId`,
    `ParcelNumber` or `FTMK01`;
  - the other chunks differ only by build-specific public values, and the
    pre-promotion canary build covered them.
- **Runtime:** 401 ×16, 200 ×4 and 307 ×2 (all from these probes); 0 error, warning or
  fatal lines.
- **Data after deploy:** unchanged: migrations 10, brokerages 0, users 1, profiles 1,
  images 1, audit events 65, business tables 0.
- **Status: DEPLOY A LIVE — waiting for the owner's signed-in smoke and Settings ›
  Brokerage configuration.** Deploy B is not started. No Bridge variable exists in
  Production.

---

# CORE V1 AGENT IDENTITY — PRODUCTION PROMOTION RE-AUDIT (2026-09-23)

**Audit only. Nothing was deployed, migrated or configured.** Production reads were
read-only SQL, the public health endpoint, and env var *names* (no values
decrypted). This section extends the audit above and does not replace it. Deploy A
(`c4e304b`, migration 0009) stands as recorded.

**Decision: GO**, conditional on the Production Bridge token passing the
three-request preflight (§R8) before it is added to Vercel.

## R1. Certified runtime

**`CERTIFIED_RUNTIME_REVISION = dadadeb`** (`dadadebe104c…`).
- The live identity certification ran on `308e549` (`dpl_3z3BifQnv6vQChnAq47EBQ34Skd4`).
- `dadadeb` changes only docs, e2e specs, and one runtime line: a copy literal in
  `components/home/widgets/featured-listing.tsx`. The "office not configured" branch
  no longer tells users to set the office in Settings, because the office is now
  server configuration.
- `dadadeb` is built on Preview as `dpl_9RLQnRqP4aA9dJAdkWStbp6LzNvX` (READY, served
  by `fortmark-dashboard-preview.vercel.app`). The regressions in §R16 were re-run
  on it.
- `c4e304b` is an ancestor of `dadadeb`, so the Production branch can fast-forward
  to it, exactly like Deploy A.
- Later commits on this branch are docs only. Do not promote any tip other than
  `dadadeb`.

## R2. Production reconfirmation (no drift)

| Item | Value |
|---|---|
| Deployment | `dpl_C1LNWdNA8CEdYTRtoXyXrrghNnH1`, READY, `c4e304b` |
| Health | `ok`, revision `c4e304b`; contacts `db`, transactions `db`, listings `not_configured`, assistant `no_credential`, actions `disabled` |
| Neon | `br-bitter-cake-av7pmzth`; bookkeeping rows **10**; last `created_at` 1790131131105 |
| Users | 1 (`admin`, `active`) |
| Profiles / images | 1 / 1 |
| Audit events | 76 |
| `brokerage_identities` | 0 rows |
| Contacts / transactions / PreparedActions | 0 / 0 / 0 |
| `mls_member_links` | absent; new brokerage columns 0/4 (0010 not applied) |
| Env (Production names) | no `BRIDGE_*`, no `MLS_LISTINGS_ENABLED`, no `FORTMARK_MLS_OFFICE_ID`, no `SAMPLE_*` |

## R3. Functional delta `c4e304b → dadadeb`

45 non-doc, non-test files. Every change belongs to one of the expected groups:

1. **Role display** (`lib/auth/session.ts`, `lib/profile/roles.ts`): the display now
   comes from `dashboard_users.role`; a shared `ROLE_DISPLAY` table.
2. **Member resolution** (`lib/mls/member.ts`, `lib/mls-identity/*`).
3. **Office sync** (`lib/brokerage/service.ts`, `app/api/brokerage/sync`).
4. **`mls_member_links`** plus **4 brokerage columns** (`lib/db/schema.ts`, `0010`,
   snapshot, journal).
5. **Onboarding MLS step** (`lib/profile/onboarding.ts`, `onboarding-wizard.tsx`).
6. **Profile MLS status** (`app/api/profile/mls`, `mls-identity-status.tsx`,
   `profile-section.tsx`, `profile-editor.tsx`; save hooks in the profile and
   onboarding routes).
7. **My Listings and co-listing** (`lib/mls/service.ts` `memberFilter`,
   `normalize.ts` `agentRole`, `fields.ts`, `query.ts`, listings routes,
   `listing-grid.tsx`).
8. **Role-aware Home and Listings default** (`featured`, `source` routes, the Home
   widget, the listings page, the adapters).
9. **System-managed brokerage MLS fields** (`lib/brokerage/identity.ts`,
   `brokerage-section.tsx`, the brokerage route).
10. **Team MLS column** (`lib/team/*`, `team-section.tsx`).
11. **Tooling:**
    - `.gitattributes` (LF for migrations; EX-C1);
    - `scripts/migrate.mjs` (the `mls_member_links` presence check, the office id
      presence log);
    - `package.json` (`test:mls-identity`).

There are **no unrelated changes**: no AI, auth middleware, contacts, transactions,
metrics or dependency changes.

## R4. Migration 0010 (`0010_flaky_toad`, journal `when` 1790138386822)

- **New table `mls_member_links`:**
  - `user_id` uuid, PK, FK → `dashboard_users.id`, ON DELETE CASCADE;
  - `status` text NOT NULL, with CHECK `mls_member_links_status_check` ∈ {linked,
    office_mismatch, not_found, ambiguous, conflict, unavailable};
  - `license_number`, `license_state`, `member_key`, `member_mls_id`,
    `office_mls_id`: text, nullable;
  - `candidate_count` int NOT NULL DEFAULT 0;
  - `checked_at`, `created_at`, `updated_at`: timestamptz NOT NULL DEFAULT now();
  - `linked_at`: timestamptz, nullable;
  - index `mls_member_links_member_key_idx` (btree, **not unique**).
- **`brokerage_identities`:** ADD COLUMN `mls_office_key`, `mls_office_name`,
  `mls_office_phone` (text) and `mls_synced_at` (timestamptz). All four are
  **nullable with no default**.
- **Nothing else:** no drops, renames, type changes, enum changes or new
  uniqueness on existing tables.

## R5. Migration risk: **LOW** (proved)

- **Table rewrites:** adding a nullable column with no default is a catalog-only
  change in Postgres, with no row rewrite (and there are 0 brokerage rows anyway).
- **Constraints that could fail:** none on existing data. The CHECK and the FK are on
  a new, empty table. The only unique constraint is the PK `user_id` (one row per
  user), and the member key index is non-unique.
- **Applying it:**
  - Drizzle applies 0010 because `1790138386822` > the last `created_at`,
    `1790131131105`.
  - Expected result: `bookkeeping rows 10 -> 11, 1 new` and "Core V1 MLS member link
    table present".
  - `npm run test:migrate` passes 23/23, including the 0010 fresh apply and a
    refused bad status.
- **Backward compatibility (old `c4e304b` on the 0010 schema):** compatible by
  construction.
  - Drizzle enumerates columns explicitly in every select and insert.
  - `c4e304b` never references `mls_member_links`, and the four new columns are
    nullable.
  - An old-code insert into `brokerage_identities` (Settings save) leaves them NULL.
- **Forward incompatibility:** the new runtime *requires* 0010. It reads
  `mls_member_links` and selects the new brokerage columns. Production builds skip
  migrations ("build guard allows preview only").
  - **Hard ordering:** apply 0010 first, then deploy `dadadeb`.
- **Rollback:** leave 0010 in place. The old app ignores it; never drop the table or
  the columns during an incident.

## R6. Production data preflight (read-only)

- `brokerage_identities`: 0 rows. After 0010 the MLS columns do not exist on any row;
  the first sync creates the row.
- The profile has a licence, state `FL`, stored without an `SL`/`BK` prefix. Resolution
  tries both spellings. The value is not recorded here.
- Legacy MLS fields: `mls_agent_id` empty, `mls_organization` empty,
  `mls_verification_status = unverified`, `mls_verified_at` null.
- With a single admin there is no possible unique-key conflict: the link PK is
  per user, and the member conflict rule needs a second linked account.

## R7. Legacy MLS profile fields: policy **A**

**Policy: leave the columns and data in place, unused.** There is nothing to clear in
Production.
- The runtime never reads them for identity, listings, Home or Team.
- No UI renders an input for them: the Profile rows and the onboarding step were
  removed in `308e549`.
- `scripts/migrate.mjs` still asserts that these Release B columns are present, so
  dropping them would be a separate, deliberate migration later (policy C).
- **Finding F2 (P3):**
  - `PATCH /api/profile` still *accepts* `mlsAgentId` and `mlsOrganization` in its
    zod schema. This is an API-only path with no UI; the values are stored as
    self-reported and never read.
  - Follow-up: remove them from the input schema. Not a promotion blocker.

## R8. Role, office configuration and Bridge token

**Role display:**
- `getSession()` labels the role with `displayRole(await applicationRole(userId),
  clerkHint)`. `applicationRole` is `resolveActor(...)`: the same
  `dashboard_users` row every API authorisation uses.
- Clerk is used only when no dashboard row exists.
- `session.role` is display-only (the user menu and the Profile badge). No route
  authorises from it, so the change cannot widen permissions.
- Expected after promotion: Profile, Team and user menu all show **Admin**.
- Production Clerk is **not** touched.

**Clerk boundary:**
- Clerk plus the allowlist decide who signs in.
- `dashboard_users.role` decides authorisation, display, the Home scope and the
  Listings default.
- Home and Listings read it through `callerListingContext → resolveActor`, and the
  session through `applicationRole → resolveActor`. That is one source.

**`FORTMARK_MLS_OFFICE_ID`:**
- It is read only in `lib/brokerage/service.ts` (`fortmarkOfficeConfig`), plus a
  presence-only log in `migrate.mjs`.
- Server-only: the module imports `server-only`, and the name is not
  `NEXT_PUBLIC_`.
- It is validated against `MLS_OFFICE_ID`. No request parameter can change it.
- If it is absent, the dashboard does not crash:
  - FortMark scopes return "not configured";
  - the sync returns `not_configured`;
  - resolution classifies a real FortMark agent as `office_mismatch`. This is
    recoverable with **Check again** once the variable is set.
- Recommended value: `FTMK01`. It is not a credential.

**Bridge token requirements:**
- It must be a Production-specific dashboard token. Do not reuse the Preview or MCP
  tokens.
- It must be able to read **Property, Member and Office**. The Preview dashboard
  credential was proven to read all three on 2026-09-23.
- A Property-only token would give general search and FortMark listings, but every
  identity would resolve `unavailable`. That is **not acceptable for this release:
  require all three.**

**Token preflight.** The operator runs this in their own shell. The token and the
licence are held in memory only and sent only in the Authorization header or the
filter; nothing is echoed.

```bash
read -rs BRIDGE_TOKEN            # paste the Production dashboard token
B='https://api.bridgedataoutput.com/api/v2/OData/miamire'
H="Authorization: Bearer $BRIDGE_TOKEN"
# 1. Property — expect 200
curl -s -o /dev/null -w 'property %{http_code}\n' -H "$H" \
  "$B/Property?\$top=1&\$select=ListingKey&\$filter=StandardStatus%20eq%20%27Active%27"
# 2. Office — expect 200 and FortMark, LLC / Active
curl -s -H "$H" "$B/Office?\$top=1&\$select=OfficeMlsId,OfficeName,OfficeStatus&\$filter=OfficeMlsId%20eq%20%27FTMK01%27" \
  | python3 -c 'import sys,json;v=json.load(sys.stdin).get("value",[]);print("office",[(r["OfficeMlsId"],r["OfficeName"],r["OfficeStatus"]) for r in v])'
# 3. Member — digits only, never echoed. Expect exactly one Active member in FTMK01.
read -rs LIC
curl -s -H "$H" "$B/Member?\$top=10&\$select=MemberStatus,OfficeMlsId&\$filter=MemberStateLicense%20eq%20%27$LIC%27%20or%20MemberStateLicense%20eq%20%27SL$LIC%27" \
  | python3 -c 'import sys,json;v=json.load(sys.stdin).get("value",[]);print("member count",len(v),[(r["MemberStatus"],r["OfficeMlsId"]) for r in v])'
unset BRIDGE_TOKEN LIC H
```

- Pass criteria: `property 200`; office `('FTMK01', 'FortMark, LLC', 'Active')`;
  member count 1, with `('Active', 'FTMK01')`.
- Any 401 or 403, or an empty member result: **stop**, and do not add the token.

## R9. Identity behaviour in the promoted code

- **Member fields selected:** exactly `MemberKey`, `MemberMlsId`, `OfficeMlsId`,
  `MemberStatus`, `MemberStateLicense` (`MEMBER_FIELDS`), with `$top=10`. There is no
  email, phone or address.
- **Office fields:** `OfficeKey`, `OfficeMlsId`, `OfficeName`, `OfficePhone`,
  `OfficeStatus`.
- **Authorisation:**
  - `GET` and `POST {}` act on the caller.
  - `POST {userId}` is honoured for admin and broker only (403 otherwise). The target
    must be an existing `dashboard_users` row (404 otherwise). The body is strict
    (only a uuid `userId`).
  - The actor, role and target all come from the session. No member key, office or
    brokerage is accepted from the browser.
- **Conflict:** a `linked` result whose member key is already linked to another user
  is stored as `conflict`, with no second link and no transfer; a broker reviews it.
  - **Finding F1 (P2):** this is enforced in the service (check, then upsert), not by
    a database constraint. Two accounts resolving the same member at the same
    instant could both link.
  - Exposure at launch is nil: there is one user.
  - Follow-up: a partial unique index on `(member_key) WHERE status = 'linked'` in a
    later migration. It is deliberately not added to the certified 0010.
- **Office mismatch:**
  - The member key is stored, but My Listings requires `linked`, so it stays off.
  - Dashboard access is untouched.
  - The brokerage sync reads only the *configured* office, never the member's, so
    another office can never be written into FortMark's record.
- **Bridge outage:**
  - The roster call has a 6 s deadline and is caught, and the result is stored as
    `unavailable`.
  - The profile and onboarding routes save first, then call `matchLicenceAfterSave`,
    which never throws.
  - Authentication, contacts, transactions and Home metrics make no Member or Office
    calls.
- **When resolution runs:**
  - after a profile or onboarding save that changes the licence;
  - on `GET /api/profile/mls` when the link is missing or stale;
  - on **Check again** (`POST`).
  - There is no background job, and no resolution per page load.
- **Finding F3 (P3, operational):**
  - In Stage A2 (MLS off), the first Profile view stores `unavailable`, which is
    correct.
  - `GET` re-resolves only a *stale* link, so after B2 the operator presses **Check
    again** once. This is smoke step 7.
  - The same applies after an outage that coincided with a check.
- **Licence change:** the stored licence no longer matches, so the link reads `stale`
  and is not used. The save re-resolves at once. A cleared licence deletes the link.
- **Audit:** `mls_identity_resolved` records `{status, candidateCount}`;
  `brokerage_mls_synced` records `{brokerageKey, changedFields, created}`. Neither
  records a licence, member key or payload.

## R10. Brokerage

- **Auto-creation:** the first sync upserts on the unique `brokerage_key` with:
  - `display_name` = the MLS `OfficeName`;
  - `mls_office_id`, `_key`, `_name`, `_phone` (E.164 when parseable) and
    `mls_synced_at`.
  - Operator fields (licence, address, website, preferred phone) are NULL.
- **Later syncs:** `ON CONFLICT … SET` writes **only** the MLS columns, so the name
  and operator fields are never overwritten.
  - An operator save writes only operator columns; any MLS field in a PUT is a 400.
- **Triggers:**
  - `GET /api/brokerage` when a sync is due (missing, wrong office, or more than 24 h
    old);
  - after the first `linked` resolution;
  - **Refresh from MLS** (admin and broker).
- **Settings UI:** the MLS section is read-only for everyone ("synced from MLS").
  Admins and brokers edit legal and business fields only. Agents, members and
  coordinators get no edit controls.
- **Owner input:**
  - The brokerage licence, legal address, website and preferred phone are central
    FortMark settings, entered once by an admin.
  - They **do not block** MLS identity or listings.
  - Recommended timing: the same session, right after B2 smoke. This must happen
    before the team is invited, because agents see the brokerage page.
  - The MLS phone is shown with a source label until a preferred phone is stored.
- **Finding F4 (ordering):**
  - Deploy A's brokerage form still lets an operator *type* an MLS office id, and
    `brokerageMlsOfficeId` falls back to the stored id when the env var is absent.
  - **Do not fill Settings › Brokerage before A2.** After A2 the form cannot carry
    the id, and with `FORTMARK_MLS_OFFICE_ID` set, configuration wins and the sync
    overwrites the column.

## R11. Listings, Home, Team, Search

- **My Listings:**
  - Filter: `DISPLAYABLE and (ListAgentKey eq K or CoListAgentKey eq K)`, where `K`
    is the stored MemberKey. There is no name matching.
  - `miamire` has exactly these two agent roles (there is no second or third
    co-listing field), so "co-listing" means `CoListAgentKey` only.
  - Rows are marked `agentRole` primary or co_listing.
  - Without a link: 409 `mls_identity_not_linked`. A linked agent with no listings
    sees a real zero.
- **Compliance:**
  - The member-scoped search and `getMyListingSummary` go through the same
    `DISPLAYABLE` clause and the same `toListing` normaliser as every other path.
    The withheld address gives no parcel and no coordinates, and non-display records
    are dropped.
  - There is no separate agent query path. The agent keys are selected server-side
    and never emitted, and the product-key test passed.
- **FortMark Listings:** matched by office id on `ListOfficeMlsId` or
  `CoListOfficeMlsId`. Without an id it returns "not configured", never the whole
  MLS.
- **MLS Search:** feed-wide, independent of the member link and the office. ⌘K is
  feed-wide and uses the same normaliser.
- **Default scope:**
  - privileged with an office configured → FortMark;
  - linked → My;
  - otherwise → MLS.
  - An admin who is also linked still opens on FortMark, and all three scopes stay
    selectable. An explicit `?office=` always wins.
- **Home:**
  - `isPrivileged` (admin, broker, transaction coordinator) → the FortMark summary.
  - Everyone else → their own listings, or "MLS identity not connected" with the
    reason.
  - The Production admin therefore gets **FortMark listings**, not a personal book.
- **Team:** `status` and `mlsState` are added for privileged viewers only. There is
  no member key and no roster data, and the MLS never creates Team users.
- **Onboarding:** licence → save → resolution. No brokerage, office or MLS agent id
  is asked for, and a Bridge outage never blocks completion.

## R12. Environment matrix (Production scope, names only)

| Variable | State now | Target | Stage |
|---|---|---|---|
| `CONTACTS_DATABASE_ENABLED`, `TRANSACTIONS_DATABASE_ENABLED` | set | unchanged (`1`) | — |
| `PROFILE_DATABASE_ENABLED`, `PROFESSIONAL_PROFILE_UI_ENABLED`, `PROFILE_IMAGE_UPLOAD_ENABLED` | set | unchanged | — |
| `FORTMARK_MLS_OFFICE_ID` | absent | `FTMK01` (Production) | **A2 recommended** (inert while MLS is off; it removes the office-mismatch hazard in B2). B2 is acceptable only if it lands in the same redeploy as the Bridge vars. |
| `BRIDGE_API_TOKEN` | absent | Production secret, **Sensitive**, Production only | B2, after the preflight |
| `BRIDGE_DATASET` | absent | `miamire` | B2 |
| `MLS_LISTINGS_ENABLED` | absent | exactly `1` | B2 |
| `BRIDGE_BASE_URL` | absent | absent | — |
| `SAMPLE_LISTINGS_ENABLED`, `SAMPLE_DASHBOARD_ENABLED` | absent | absent | — |
| `AI_PROVIDER` and every other AI variable | as is | **unchanged**; no AI key | — |

## R13. Rollout

**Stage A2: identity code with MLS off**
1. Reconfirm: health `c4e304b`, 10 bookkeeping rows, counts as in §R2.
2. **Backup branch** from `br-bitter-cake-av7pmzth`, named
   `pre-agent-identity-promotion-<YYYYMMDDTHHMMZ>-from-production-fortmark-professional-profiles`.
   Record its id and LSN. Never restore without human approval.
3. The operator runs `npm run db:migrate` from a clean `dadadeb` checkout, as for 0009
   (fingerprint `23deffc7e4e5`, else STOP).
   - Expect `10 -> 11, 1 new` and "Core V1 MLS member link table present"; exit 0.
   - Then check: 11 rows, table present, brokerage columns 4/4.
4. Old-app check: health still `c4e304b` ok, and Profile loads.
5. (Recommended) set `FORTMARK_MLS_OFFICE_ID=FTMK01` in Production.
6. Fast-forward `claude/fortmark-dashboard-build-v39u96` from `c4e304b` to `dadadeb`.
   The build logs "migrations skipped".
7. A2 smoke:
   - health: revision `dadadeb`, listings `not_configured`;
   - Profile, Team and user menu show **Admin**;
   - the Profile MLS status says MLS unavailable, with no error page;
   - Brokerage shows its read-only MLS section, not synced;
   - contacts and transactions load; Home shows no listing errors;
   - runtime error logs are clean.
8. The A2 deployment becomes the preferred rollback target.

**Stage B2: MLS on, same runtime**
1. Token preflight (§R8), with all three checks passing.
2. Add `BRIDGE_API_TOKEN`, `BRIDGE_DATASET=miamire`, `MLS_LISTINGS_ENABLED=1` (and
   `FORTMARK_MLS_OFFICE_ID` if it was not set in A2).
3. Redeploy the A2 deployment (same commit) so the env binds.
4. Run the smoke in §R15.

## R14. Rollback

- **Application:**
  - Use instant rollback to an *existing* deployment: A2 (MLS off), or
    `dpl_C1LNWdNA8CEdYTRtoXyXrrghNnH1` (`c4e304b`). Both are compatible with 0010.
  - Don't rebuild old revisions once Bridge vars exist. Never rebuild `b4c04d0` after
    the Bridge Production variables exist.
- **MLS:** instant rollback to the A2 deployment, whose env was bound with MLS off.
  Alternatively, remove `MLS_LISTINGS_ENABLED` and redeploy. Identity rows stay; the
  links read `unavailable` or stay as they are, and nothing else is affected.
- **Database:**
  - 0010 stays. No drops during an incident.
  - A restore from the backup branch needs explicit human approval and would lose
    post-migration writes (links, audit events, brokerage row).

## R15. Production smoke (owner session, no fixtures, no fixed counts)

1. **Health:** `dadadeb`, listings `mls`.
2. **Sign in.**
3. **Role badge:** Admin.
4. **Team:** Admin, with the MLS column.
5. **Profile:** the licence is shown as self-reported; the value is not logged.
6. **Brokerage:** the MLS section is populated automatically (`FTMK01`, "FortMark,
   LLC", synced time) and read-only. Legal fields are editable.
7. **Check again:** press it on Profile.
8. **Member linked:** the state is Connected · FortMark, LLC.
9. **My Listings:**
   - the count is dynamic;
   - "You · Listing agent" or "You · Co-listing agent" is shown on several cards;
   - every card is FortMark's.
10. **FortMark Listings:** only `FTMK01`, with a dynamic active count, and My
    Listings ⊆ FortMark.
11. **General MLS:** a Fort Lauderdale active search returns results from many
    offices.
12. **Home:** shows **FortMark listings** (not My listings), and the count equals the
    FortMark total.
13. **⌘K:** an MLS number opens the listing detail.
14. **Detail and media:** attribution, photos, and the withheld-address rule.
15. **Network:** 0 browser requests to Bridge, and no member key in any response.
16. **Logs:** runtime errors are clean.
    - Allowed: `[mls-identity]` lines with an error name only.
    - Not allowed: any licence, key or token.

There are no business mutations beyond the MLS sync and link. The optional central
brokerage legal fields can be entered afterwards.

## R16. Tests carried into promotion

- **Offline** (on `dadadeb`): the full `npm test` passes.
  - profile 1212, MLS 225, MLS identity 112, brokerage 98, team 30, and every other
    suite;
  - typecheck clean.
- **Migration:** `npm run test:migrate` 23/23.
- **Live on `308e549`:**
  - agent-identity agent 8/8 and admin 10/10;
  - brokerage editor 10/10 and empty-readonly 7/7;
  - mls-live 12 passed and 3 skipped (the skips are input-driven);
  - zero-data sweep 8/8.
- **Live on `dadadeb` (`dpl_9RLQnRqP4aA9dJAdkWStbp6LzNvX`):** see §R16a.
- Office mismatch, ambiguous and unavailable are certified offline (stub roster).

### R16a. Regression on `dadadeb` (Preview `dpl_9RLQnRqP4aA9dJAdkWStbp6LzNvX`, certification user as `member`)

- **Combined run** (`zero-data-sweep` plus `mls-live`, 2.8 min): 15 passed, 3 skipped,
  **2 failed**. Both failures were render timeouts: the page never produced its
  content within the 30 s and 60 s waits.
  - zero-data "each unbacked route says what is missing": 30.6 s against its usual
    8 s;
  - mls-live "rendered": 59.2 s.
  - Every API-level assertion in the run passed, including the role-aware
    FortMark/Home count check.
- **Isolated re-runs:**
  - `zero-data-sweep`: **8/8**;
  - mls-live "rendered": **passed twice** (27.7 s and 28.8 s).
- **Classification:** the known page-load stall, which has been seen in every phase
  since Stage 1 and in both `308e549` runs. It is not caused by this delta; the only
  runtime change is one copy string.
- It is not a promotion blocker. Production smoke step 16 watches for client-side
  errors, and a stalled page there is a stop-and-look, not a retry-until-green. Findings

| Id | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | P2 | Member conflict is enforced in the service, not by a DB constraint (race window) | Follow-up migration (a partial unique index); not a blocker with one user |
| F2 | P3 | `PATCH /api/profile` still accepts legacy `mlsAgentId` / `mlsOrganization` (no UI) | Follow-up: tighten the input schema |
| F3 | P3 | An `unavailable` link is not auto-retried; it needs Check again | Smoke step 7; documented |
| F4 | ordering | Deploy A's brokerage form can store a typed office id; the fallback reads it when the env var is absent | Don't use Settings › Brokerage before A2; set `FORTMARK_MLS_OFFICE_ID` |
| — | ordering | `dadadeb` requires 0010 | Migrate before the fast-forward |

**Production blockers: NONE.** The only external dependency is the Production
Bridge token passing the preflight.

## R18. Human checklist (minimal)

1. Obtain a **Production dashboard Bridge token** that can read Property, Member and
   Office, and run the §R8 preflight.
2. Authorise execution, then:
   - create the backup branch;
   - run 0010 with the canonical runner (operator-run, as for 0009).
3. After B2: enter FortMark's **brokerage licence, legal office address**, and
   optionally the website and preferred phone, once, in Settings › Brokerage.

**Not needed:** any agent MLS id, any per-agent office or brokerage, any Clerk
change, any SQL identity insert.

**AI:** unchanged (provider `openai`, model `gpt-5.5`, no credential, actions
disabled). Identity works with AI off.

**O1:** frozen. Nothing from Opportunity is mixed into 0010.

---

# STAGE A2 EXECUTION — agent identity code, MLS off (2026-09-23)

**Reconfirmation (18:33Z / 18:5xZ):**
- health `c4e304b` ok; 10 migrations; `mls_member_links` absent;
- users 1 (`admin`), profiles 1, images 1, brokerage 0, contacts 0, transactions 0,
  PreparedActions 0;
- audit 76 → 87. Every new event is `user_synced_from_clerk` from the owner's
  sign-ins.

**Safety branches:**
- `br-tiny-unit-avsngi1d`: `pre-agent-identity-promotion-20260923T1833Z-…`,
  LSN `0/1F5B5F8`. This is the pre-0010 restore point.
- `br-mute-union-avbf43km`: an earlier copy at 17:12Z, `0/1F31728`.
- Neither has been modified, and neither may be restored without human approval.

**Migration method:**
- The runner process could not be started from the cloud session without the
  Production connection string passing through tool output. The Vercel variable is
  write-only, and the Neon connection-string tool returns it as plain text.
- Per the owner's instruction, 0010 was applied through the Neon SQL
  transaction action. That transaction reproduces `runMigrations` exactly:
  1. `pg_advisory_xact_lock(7214050913)`, the runner's lock key;
  2. a guard that aborts unless the state is 10 bookkeeping rows, last `created_at`
     `1790131131105`, last hash `f4c19419…` (Production's unique 0009 row), and the
     links table absent;
  3. the 7 statements produced by drizzle's own `readMigrationFiles`, verbatim.
     `assertTransactionSafe` passed on all 11 migrations;
  4. drizzle's bookkeeping insert: hash `43217604…6cc8`, `created_at` `1790138386822`.
     That is byte-identical to the row the canonical runner wrote for 0010 on
     Preview.
- Everything ran as one transaction and committed.

**Verification:**
- 11 bookkeeping rows.
- Column, constraint and index fingerprints of `mls_member_links` and
  `brokerage_identities` are identical to certified Preview (`78ed9b6e…`,
  `0f01136c…`, `8d75b0f8…`), with 208 public columns on both.
- Links 0, brokerage 0, every other count unchanged.
- The old app `c4e304b` on 0010: health ok, 200s only, and no error or warning log
  lines.

**Configuration:** `FORTMARK_MLS_OFFICE_ID=FTMK01` (Production only, env id
`SXhMjMSDr62ndfxU`).
- Production now has 31 variables. There are no `BRIDGE_*`, `MLS_LISTINGS_ENABLED` or
  `SAMPLE_*` variables, and `AI_PROVIDER` is unchanged.

**Deploy A2:** `claude/fortmark-dashboard-build-v39u96` was fast-forwarded
`c4e304b → dadadeb`. That produced a fresh Production build,
**`dpl_6PtaBiMaihNhomQ5Us6xgWv5iDWg`**, READY and aliased to
`fortmark-dashboard.vercel.app`.
- Build log:
  - fingerprint `23deffc7e4e5`;
  - `FORTMARK_MLS_OFFICE_ID present=true`;
  - `BRIDGE_API_TOKEN present=false`;
  - migrations skipped.
- The build log's "-> sample data" label is the migrator's classification wording
  only. `SAMPLE_LISTINGS_ENABLED` is absent, and health reports listings
  `not_configured`.
- Health:
  `{"ok":true,"revision":"dadadeb","sources":{"transactions":"db","contacts":"db","listings":"not_configured","homeMetrics":"real-only","assistant":{"provider":"openai","model":"gpt-5.5","status":"no_credential"},"actions":"disabled"}}`.
- Post-deploy: no error or warning log lines. Database counts are unchanged
  (links 0, brokerage 0).
- A local build of `dadadeb` had 95 client chunks. None contained a Bridge host, a
  secret variable name, `MemberKey`, `ListAgentKey`/`CoListAgentKey`, `member_key` or
  `FORTMARK_MLS_OFFICE_ID`.

**Rollback targets:**
- A2 `dpl_6PtaBiMaihNhomQ5Us6xgWv5iDWg`, once the signed-in smoke passes;
- `dpl_C1LNWdNA8CEdYTRtoXyXrrghNnH1` (`c4e304b`), compatible with 0010.
- 0010 stays in place under any rollback.

B2 has not started.
