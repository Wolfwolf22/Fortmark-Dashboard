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
