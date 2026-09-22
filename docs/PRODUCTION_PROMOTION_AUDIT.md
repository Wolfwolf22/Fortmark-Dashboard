# FortMark Dashboard — Production Promotion Audit

**Audit date:** 2026-09-22
**Scope:** audit only. Nothing in Production was deployed, merged, migrated,
flagged, keyed or otherwise mutated while producing this document. Every
Production database read was a read-only query. No secret value was
decrypted, printed, hashed, measured or copied; secrets are reported as
present/absent only.

**Decision:** **GO FOR STAGED PRODUCTION PROMOTION** — subject to the
mandatory execution gates in §3. The plan below is reviewed before it is
executed; this document does not authorise execution.

---

## 1. Certified source

| Item | Value |
|---|---|
| Dashboard repo | `wolfwolf22/fortmark-dashboard` |
| Certified branch | `claude/dashboard-status-yir55p` |
| Promotion revision (HEAD) | `b4c04d0` (`b4c04d0ba5abeefe21835bcbad558ce814a11480`), clean, pushed |
| Last runtime-changing commit | `05c29cb` — the revision the certified Preview health reports |
| `05c29cb..b4c04d0` | `e2e/**` and `docs/**` only (8 files). Runtime code is byte-identical; a build of `b4c04d0` is the certified runtime. |
| Preview migration level | `0008_loud_warstar` (9 migrations, 0000–0008) |
| Preview health | `transactions: db`, `contacts: db`, `listings: not_configured`, `homeMetrics: real-only`, `assistant: openai / gpt-5.5 / available`, `actions: enabled` |
| Certification | full-system Playwright 29/29 in one run; offline 2,551/2,551; typecheck clean; build clean; P0 none; P1 none |
| AI tool registry | 9 read / 2 propose / 0 execute |
| Portal (certified Preview) | `wolfwolf22/fortmark-app` `fcf56c1` |
| Opportunity O1 | frozen — not started |

## 2. Current Production

| Item | Value |
|---|---|
| Dashboard Production deployment | `dpl_5WFnRw8PyQuEm7XpcWBhBYdrNp9M`, revision `625dc90`, branch `claude/fortmark-dashboard-build-v39u96` (the repo's default/Production branch, tip `625dc90`) |
| Previous Production deployment | `dpl_5mhP5wrAYtd7pENYn5Lpif1gsuoY` (same commit `625dc90`) |
| Served at | `https://app.fortmark.net/dashboard` through the portal's `/dashboard` rewrite; dashboard `basePath` is `/dashboard` |
| Portal Production | `dpl_BV3kHHVtZHAH5SjTvKGmaig14AYZ`, `b819667` on `main` |
| Clerk (Production) | `pk_live` instance on `clerk.fortmark.net` (Preview uses a separate `pk_test` dev instance) |
| Production DB | Neon branch `br-bitter-cake-av7pmzth` — proven to be the Production `DATABASE_URL` / `DATABASE_URL_UNPOOLED` target by host fingerprint |
| Production migration level | `0000`–`0004` applied (5 rows in `drizzle.__drizzle_migrations`); `0005`–`0008` not applied |
| Production data (counts only) | 1 dashboard user (role `member`, status `active`), 1 profile, 1 profile image, 46 audit events. No certification, fixture or synthetic rows. |

**Code delta 625dc90 → b4c04d0:** 115 commits, 220 files, +37,479 / −1,679.
The Production branch is a strict ancestor of the certified HEAD (115 ahead,
0 behind), so promotion is a fast-forward — no merge commit, no conflict.

**What current Production serves today:** `625dc90` renders unlabelled
fixture data on Leads, Transactions, Home metrics, Reports, Messages,
Calendar, Documents and Notifications. Promotion is the remedy for that, not
a new risk. (This matters for rollback — see §11.)

### Environment separation (proven)

| Boundary | Preview | Production | Shared? |
|---|---|---|---|
| Neon branch for `DATABASE_URL*` | certification branch | `br-bitter-cake-av7pmzth` | No (different host fingerprints) |
| Clerk instance | `pk_test` dev instance | `pk_live`, `clerk.fortmark.net` | No |
| `CLERK_AUTHORIZED_PARTIES` | three `*.vercel.app` preview origins | `https://app.fortmark.net` only | No |
| `NEXT_PUBLIC_APP_URL` | `https://fortmark-app-preview.vercel.app` | `https://app.fortmark.net` | No |
| `OPENAI_API_KEY` | present | **absent** | No |
| AI / contacts / transactions flags | present (Preview scope) | **absent** | No |
| `SAMPLE_DASHBOARD_ENABLED` | absent | absent | — |
| Certification identity | Preview Clerk dev instance only | not a Production user | No |
| Preview aliases | `*-preview.vercel.app`, git-branch URLs | not Production aliases | No |

The Neon integration's `POSTGRES_*` / `PG*` / `NEON_PROJECT_ID` variables
are scoped to both Preview and Production. **No code reads them** (repository
grep of `app/`, `lib/`, `middleware.ts`, `next.config.*`, `scripts/migrate.mjs`):
the runtime and the migrator read `DATABASE_URL` / `DATABASE_URL_UNPOOLED`
only, which are separately scoped. Informational; not a blocker. Never switch
code to the `POSTGRES_*` names.

---

## 3. Mandatory execution gates

These do not block the plan; they block **steps** of the plan. Each is
checked in the operator checklist (§15).

### Gate A — Contacts/Transactions env flags set before the promotion build (Finding B, P2, config-gated)

With `CONTACTS_DATABASE_ENABLED` / `TRANSACTIONS_DATABASE_ENABLED` absent,
`contactsSource()` / `transactionsSource()` return `"sample"` and the list
pages render fixture rows **without** the sample notice — independent of
`SAMPLE_DASHBOARD_ENABLED`. Production has neither flag today.

- Set both to `1` in **Production scope** before the promotion build.
- Verify `/api/health` reports `contacts: "db"` and `transactions: "db"`
  before anyone is told the release is live. Anything else → roll back (§11).
- **Never** remove these flags as a kill switch: removal turns real mode into
  unlabelled fixtures. A database fault must surface as unavailable/error,
  which the certified code already does with the flags on.
- Follow-up (not in this promotion, needs its own certification): make the
  unflagged source `not_configured` unless `SAMPLE_DASHBOARD_ENABLED=1`.

### Gate B — Migrations 0005–0008 applied before the application deploy

The Production build never migrates (`scripts/migrate.mjs` exits unless
`VERCEL_ENV=preview` or `--force`). With the flags on and the tables absent,
Contacts/Transactions/AI actions would error (honestly, but pointlessly).
Migrations are applied explicitly first (§6); `625dc90` is unaffected by the
additive schema.

### Gate C — Human decision on the sole Production user's role (Finding A)

The only Production user is `member`. `member` cannot create or write
contacts or transactions (`canCreateOwnedFor`, `canWriteOwned`,
`canOwnRecords` all refuse). The role is written once on first sync and never
updated, so changing Clerk metadata alone will not change it. Promotion is
safe without this decision — the user sees honest zero states and a
permission refusal on create — but the release is not *useful* until a human
approves a role change. See §7 for the audited procedure. The audit made no
change.

### Gate D — AI key is a human action

No Production OpenAI key exists and none was created or copied. The Preview
key must not be reused. AI stays off at launch (§9).

---

## 4. Environment matrix

Secrets: presence only. Preview column describes the certified branch's
Preview scope. "Encrypted" means Vercel type `encrypted`; "sensitive" means
write-only.

| Variable | Preview | Production | Class | Required launch state | Safe if absent? | Action |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | present (sensitive) | present (sensitive) | REQUIRED BEFORE DEPLOY · NEVER CLIENT | present, prod branch | No | none |
| `DATABASE_URL_UNPOOLED` | present (sensitive) | present (sensitive) | REQUIRED BEFORE DEPLOY · NEVER CLIENT | present, prod branch | Falls back to pooled | none |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | present | present | REQUIRED BEFORE DEPLOY (client scope by design) | `pk_live` | No — 503 via `clerkIsConfigured()` | none |
| `CLERK_SECRET_KEY` | present (sensitive) | present (sensitive) | REQUIRED BEFORE DEPLOY · NEVER CLIENT | present | No — 503 | none |
| `CLERK_AUTHORIZED_PARTIES` | 3 preview origins | `https://app.fortmark.net` | REQUIRED BEFORE DEPLOY | unchanged | Falls back to `NEXT_PUBLIC_APP_URL` | none |
| `NEXT_PUBLIC_APP_URL` | preview portal | `https://app.fortmark.net` | REQUIRED BEFORE DEPLOY | unchanged | No | none |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | `/sign-in` | REQUIRED BEFORE DEPLOY | unchanged | — | none |
| `FORTMARK_ALLOWED_CLERK_USER_IDS` | present | present | REQUIRED BEFORE DEPLOY · NEVER CLIENT | unchanged; **do not add** the certification user | Fails closed (`allowlist_absent`) | none |
| `PROFILE_DATABASE_ENABLED` | present | present | REQUIRED (current architecture) | on (unchanged) | Profile features degrade | none |
| `PROFESSIONAL_PROFILE_UI_ENABLED` | absent on certified branch (branch-scoped elsewhere) | present | OPTIONAL / FEATURE-GATED | unchanged | Profile chrome falls back | none — see Finding C |
| `PROFILE_IMAGE_UPLOAD_ENABLED` | absent on certified branch | present | OPTIONAL / FEATURE-GATED | unchanged | Upload disabled | none — see Finding C |
| `PROFILE_BLOB_READ_WRITE_TOKEN` | absent (Preview uses `BLOB_READ_WRITE_TOKEN`) | present (sensitive) | OPTIONAL · NEVER CLIENT | present (unchanged) | Upload fails closed; Production never falls back to `BLOB_READ_WRITE_TOKEN` | none |
| `BLOB_READ_WRITE_TOKEN` | present (sensitive) | absent | NEVER CLIENT | absent in Production | Yes | none |
| `DATABASE_ACCESS_CONTROL_ENABLED` | absent (certified) | present | Reserved — defined in `lib/flags.ts`, consumed by nothing at runtime (logged by migrator only) | unchanged | Yes | none |
| `CONTACTS_DATABASE_ENABLED` | present | **absent** | REQUIRED BEFORE DEPLOY (Gate A) | `1` | **No — unlabelled fixtures** | **SET `1`, Production scope, encrypted** |
| `TRANSACTIONS_DATABASE_ENABLED` | present | **absent** | REQUIRED BEFORE DEPLOY (Gate A) | `1` | **No — unlabelled fixtures** | **SET `1`, Production scope, encrypted** |
| `AI_PROVIDER` | present (`openai`) | absent | OPTIONAL / FEATURE-GATED | `openai` | Defaults to `anthropic` → `no_credential` | **SET `openai`** (so health and the eventual key agree) |
| `AI_MODEL` | absent | absent | OPTIONAL | absent (→ `gpt-5.5`) | Yes | leave unset |
| `AI_CHAT_PROVIDER_ENABLED` | present | absent | MUST REMAIN OFF AT LAUNCH | absent | Yes → `disabled` | none at launch; Stage 8 |
| `OPENAI_API_KEY` | present (sensitive) | absent | MUST REMAIN OFF AT LAUNCH · NEVER CLIENT | absent | Yes → `no_credential` | none at launch; Stage 8, **new Production key** |
| `ANTHROPIC_API_KEY` | absent | absent | NEVER CLIENT | absent | Yes | none |
| `AI_ACTIONS_ENABLED` | present | absent | MUST REMAIN OFF AT LAUNCH | absent | Yes → propose tools withheld | none; Stage 9 |
| `SAMPLE_DASHBOARD_ENABLED` | absent | absent | MUST REMAIN OFF (never in Production) | absent | Yes → honest `not_configured` | none |
| `SAMPLE_LISTINGS_ENABLED` | absent | absent | MUST REMAIN OFF | absent | Yes | none |
| `MLS_LISTINGS_ENABLED` | absent | absent | MUST REMAIN OFF AT LAUNCH | absent | Yes → `not_configured` | none |
| `BRIDGE_API_TOKEN` / `BRIDGE_DATASET` / `BRIDGE_BASE_URL` | absent | absent | OPTIONAL · token NEVER CLIENT | absent | Yes | none |
| `DASHBOARD_ORIGIN` | absent | absent | not read by runtime or build | — | — | none |
| `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV` | system | system | system | — | — | none |

Only `NEXT_PUBLIC_*` variables reach the client bundle, and the three that
exist are non-secret by design. A compiled-bundle scan of the certified build
found no secret material (the `sk-` hits are Tailwind `mask-*` classes; the
`CLERK_SECRET_KEY` string is an identifier inside Clerk's shared library and
was already present in `625dc90`).

**Timing.** Vercel binds env at deploy time. `625dc90` reads none of
`CONTACTS_DATABASE_ENABLED`, `TRANSACTIONS_DATABASE_ENABLED`,
`AI_CHAT_PROVIDER_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`,
`AI_ACTIONS_ENABLED`, `SAMPLE_DASHBOARD_ENABLED`, `SAMPLE_LISTINGS_ENABLED`,
`MLS_LISTINGS_ENABLED` (0 references each), so setting the launch variables
before the deploy cannot affect the running deployment, and the new code
never starts without them.

### Finding C (P3) — Production profile flags were not on in the certified Preview

`PROFESSIONAL_PROFILE_UI_ENABLED` and `PROFILE_IMAGE_UPLOAD_ENABLED` are on
in Production but were not in the certified branch's Preview scope. The
profile code delta since `625dc90` is small (a once-per-process log line when
the Blob credential is missing; audit scrubbing moved to
`lib/audit/metadata.ts` with identical behaviour), and the offline profile
suite covers both flag states. Mitigation: Stage 5 smoke includes the profile
page and photo. Optional pre-promotion hardening: enable both flags in the
certified branch's **Preview** scope, redeploy Preview, and run the profile
smoke there.

---

## 5. Initial launch configuration

| Capability | Launch state | Reason |
|---|---|---|
| Profile DB, profile UI, profile photo | ON (unchanged) | Already live in Production |
| Contacts DB | ON | Certified; Gate A |
| Transactions DB | ON | Certified; Gate A |
| Home metrics | real-only (derived) | Follows from the above; `SAMPLE_DASHBOARD_ENABLED` absent |
| Search / command palette | ON (no flag) | Reads real sources only |
| FortMark AI (read-only) | OFF | Stage 8, after key provisioning and observation |
| AI actions (propose/confirm) | OFF | Stage 9 |
| MLS listings | not_configured | No Bridge credential in any environment |
| Sample dashboard / sample listings | OFF | Never in Production |
| Calendar, Documents, Messages, Reports, Notifications, Market Activity, Team integrations | honest `not_configured` | No backing service; server-authoritative gate |

---

## 6. Migration audit

### 6.1 Matrix

| # | Tag | Journal `when` | Production | Objects | Destructive? | Risk | Compatible with `625dc90`? |
|---|---|---|---|---|---|---|---|
| 0000 | `foamy_redwing` | 1785259890063 | applied | base users/profile/audit | — | — | — |
| 0001 | `cool_puppet_master` | 1785384367484 | applied | — | — | — | — |
| 0002 | `light_tomas` | 1785709767872 | applied | — | — | — | — |
| 0003 | `bored_slyde` | 1785713531106 | applied | — | — | — | — |
| 0004 | `blue_lorna_dane` | 1787106506541 | applied | — | — | — | — |
| 0005 | `broad_sumo` | 1789953026736 | **pending** | 5 enums; tables `transactions`, `transaction_parties`, `transaction_deadlines`, `transaction_events`; 9 indexes; FK constraints | No | LOW | Yes — new objects only |
| 0006 | `natural_energizer` | 1789954214580 | **pending** | 5 enums; tables `contacts`, `contact_opportunities`, `contact_activities`; 8 indexes; FK constraints | No | LOW | Yes |
| 0007 | `purple_iceman` | 1790026109734 | **pending** | 1 enum; table `ai_prepared_actions`; 3 indexes; FK | No | LOW | Yes |
| 0008 | `loud_warstar` | 1790092212914 | **pending** | `ai_prepared_actions.pending_key text` (nullable) + partial unique index `WHERE status='prepared'` | No | LOW (table empty in Production) | Yes |

No `DROP`, `RENAME`, `ALTER COLUMN` or `SET NOT NULL` in 0005–0008. No
existing table gains a column. The FK constraints on the new tables take a
brief lock on referenced existing tables (`dashboard_users`, one row). No
backfill. Production has no rows that could collide with any new unique
index.

### 6.2 Mechanism

Drizzle's migrator applies, in journal order, every migration whose `when`
is newer than the newest `created_at` in `drizzle.__drizzle_migrations`
(Production: 1787106506541). It runs them in one transaction. Hashes are
recorded per migration.

**Recommended:** an explicit operator run of the repository's migrator at the
certified revision, not a build-time migration:

```
# From a clean checkout of b4c04d0, in an operator shell.
# The connection string comes from the Neon console for br-bitter-cake-av7pmzth
# (unpooled). Paste it into the environment only; never into a file, a
# ticket, a chat or shell history.
DATABASE_URL_UNPOOLED='<paste>' npm run db:migrate      # node scripts/migrate.mjs --force
```

The script prints only host fingerprints (sha256 of hostname, 12 hex chars).
The operator confirms the printed branch fingerprint matches the Production
fingerprint recorded in the audit working notes before letting it continue —
it is the only guard against migrating the wrong branch.

Do **not** change `scripts/migrate.mjs` or the build command for this
promotion; the Preview-only build guard is the correct Production behaviour.

### 6.3 Verification (read-only)

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;                       -- expect 9
SELECT max(created_at) FROM drizzle.__drizzle_migrations;                -- expect 1790092212914
SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at;       -- rows 6–9 must equal the Preview hashes
                                                                         -- (fce71405…, 84916237…, 2e43cf92…, efab9abe…)
SELECT to_regclass('public.contacts'), to_regclass('public.transactions'),
       to_regclass('public.ai_prepared_actions');                        -- all non-null
SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_prepared_actions_pending_key_idx';
                                                                         -- UNIQUE … WHERE status = 'prepared'
SELECT count(*) FROM dashboard_users;                                    -- still 1
SELECT count(*) FROM audit_events;                                       -- ≥ 46 (unchanged by migration)
```

Also run the Neon schema comparison of the Production branch against the
certified Preview branch: the expected diff is empty for schema objects.

---

## 7. Data preflight and the role decision

- Production contains one real user, one profile, one image and 46 audit
  events. No certification, fixture or synthetic data. Nothing is seeded by
  this plan; the post-promotion state for Contacts, Transactions and AI
  actions is empty.
- **Zero-state expectation:** Home shows real-only zero metrics; Contacts and
  Transactions show empty states; Listings shows not-configured; unbacked
  modules show not-configured; no `SampleDataNotice` anywhere.

**Role change (Gate C) — only after a human names the target role.** The
role enum is `admin | broker | transaction_coordinator | agent | member`.
The change is one audited transaction run by the operator (IDs are looked up
by email in the same statement so none need be copied anywhere):

```sql
BEGIN;
WITH u AS (
  UPDATE dashboard_users
     SET role = '<approved role>', updated_at = now()
   WHERE primary_email = '<approved user email>' AND role = 'member'
  RETURNING id
)
INSERT INTO audit_events (actor_user_id, target_user_id, event_type, safe_metadata)
SELECT NULL, id, 'role_changed',
       jsonb_build_object('from', 'member', 'to', '<approved role>',
                          'reason', 'production launch', 'via', 'operator')
  FROM u;
-- expect: INSERT 0 1. Anything else → ROLLBACK.
COMMIT;
```

(Confirm column names against `lib/db/schema.ts` at execution time; the
statement is a template, not an executed change.) The Neon backup branch in
Stage 1 is also the restore point for this change.

---

## 8. Topology and cross-version compatibility

The portal needs **no promotion**: Production `b819667` and certified
Preview `fcf56c1` are behaviourally identical for everything the dashboard
depends on (`/dashboard` rewrite, canonical origin `https://app.fortmark.net`
in `buildAuthorizedParties`, Clerk session). No DNS, domain, Cloudflare or
Vercel domain change.

| Portal | Dashboard | Works? | Notes |
|---|---|---|---|
| `b819667` (prod) | `625dc90` (prod) | Yes | today |
| `b819667` | `b4c04d0` | Yes | the promotion |
| `fcf56c1` | `625dc90` | Yes | no portal change needed either way |
| `fcf56c1` | `b4c04d0` | Yes | certified pair |

Dashboard auth surface since `625dc90`: `getAuthorizedParties()` and
`lib/auth/dashboard-access.ts` are unchanged; the allowlist still fails
closed. Additions: `/api/health` is public (content-free, `no-store`), and a
missing Clerk config returns 503 instead of throwing. Nothing weakens auth.

DB compatibility: `625dc90` against schema 0008 works (additive only), which
is what makes app rollback independent of schema rollback.

---

## 9. AI rollout

| Stage | Config | Entry criteria |
|---|---|---|
| Launch | `AI_PROVIDER=openai`; no key; `AI_CHAT_PROVIDER_ENABLED` and `AI_ACTIONS_ENABLED` absent | — |
| Stage 8 — read-only | new **Production** OpenAI project key (`OPENAI_API_KEY`, sensitive, Production scope only) + `AI_CHAT_PROVIDER_ENABLED=1`; redeploy | Stages 1–7 green; ≥ 24 h clean observation; a human has created the key in a dedicated Production project with a monthly budget cap and usage alerts |
| Stage 9 — actions | `AI_ACTIONS_ENABLED=1`; redeploy | ≥ 7 days read-only with no auth/tool errors; spend within budget; audit events reviewed; a human approves |

Bounds already in code (per request): 40 messages, 24,000 chars per message,
120,000 chars total; 16,000 max output tokens; 5 tool rounds × 4 calls;
8 s per tool; tool rows 8 default / 20 max. Over-size → 413; provider rate
limit → 429 "Busy"; client cancel → 499. Actions are propose-then-confirm
with human confirmation, expiry, idempotent pending key (0008), audit events,
and no execute tools in the registry.

Model variance was certified against `gpt-5.5`; leave `AI_MODEL` unset so
the default stays the certified model.

---

## 10. Health expectation

`GET https://app.fortmark.net/dashboard/api/health` (public, `no-store`):

After Stage 3 (launch):

```json
{"ok":true,"revision":"b4c04d0",
 "sources":{"transactions":"db","contacts":"db","listings":"not_configured",
            "homeMetrics":"real-only",
            "assistant":{"provider":"openai","model":"gpt-5.5","status":"no_credential"},
            "actions":"disabled"}}
```

After Stage 8: `assistant.status: "available"`, `actions: "disabled"`.
After Stage 9: `actions: "enabled"`.

Any of `contacts`/`transactions` ≠ `"db"`, `homeMetrics` ≠ `"real-only"`,
`revision` ≠ `b4c04d0`, or a non-200 → rollback trigger (§11).

---

## 11. Rollback

### 11.1 Application rollback

| Trigger | Action | Target |
|---|---|---|
| Health wrong (§10), auth broken, sustained 5xx, any fixture data visible | Vercel **Instant Rollback** of the dashboard project | `dpl_5WFnRw8PyQuEm7XpcWBhBYdrNp9M` (`625dc90`) — the immediately previous Production deployment, available on every plan |
| Instant rollback unavailable | Redeploy `625dc90` as Production from the Vercel dashboard (Redeploy on that deployment) | same commit |
| Stage 8/9 problem (AI) | Instant rollback to the Stage 3 deployment (AI off) | the promotion deployment — no fixtures |

After an instant rollback Vercel stops auto-assigning Production from git
pushes until the rollback is undone; the next promotion must be explicit.

**Rollback to `625dc90` restores the pre-existing Production experience,
which includes unlabelled fixture pages.** It is the status quo ante, not a
fallback for database failure, and it is only used for application defects.
A database fault on the new code surfaces as unavailable/error, and must be
handled as a database incident (§11.2) — never by rolling back to fixtures
and never by removing the Contacts/Transactions flags. Records created after
promotion are not lost by an app rollback; `625dc90` simply does not read
them.

The Portal is not changed, so it has no rollback step.

### 11.2 Database rollback

- **Default: leave the additive schema in place.** `625dc90` ignores it.
  Do not drop tables to "roll back".
- **Migration failed mid-run:** the migrator is transactional; nothing is
  applied. Verify with §6.3 (count still 5), fix, re-run.
- **Data damage after promotion (last resort, human decision):** restore
  `br-bitter-cake-av7pmzth` from the Stage 1 backup branch (Neon branch
  restore) or PITR (free plan: 6 h window). This discards every write since
  the restore point — including profile edits and any real records — so it
  requires explicit approval and an app rollback first.

### 11.3 Kill switches

| Switch | Effect | Latency |
|---|---|---|
| Instant rollback | whole app to previous deployment | seconds |
| Remove `AI_ACTIONS_ENABLED` + redeploy | propose tools withheld | one build |
| Remove `AI_CHAT_PROVIDER_ENABLED` + redeploy | assistant `disabled` | one build |
| Revoke/rotate the Production OpenAI key at the provider | assistant errors → honest unavailable | immediate |
| **Not** a kill switch | removing `CONTACTS_/TRANSACTIONS_DATABASE_ENABLED` | would expose fixtures |

---

## 12. Smoke test (Stage 5 — authorized real user, human)

No certification user, no minted session, no test login endpoint in
Production. A human who is already on the Production allowlist signs in
normally at `https://app.fortmark.net` and opens `/dashboard`.

1. Sign-in → dashboard loads; no redirect loop; no 401/403 from middleware.
2. Home: real-only; zero metrics; no `SampleDataNotice`; no fixture names.
3. Contacts: empty state. As `member`, create is refused (expected until Gate C).
4. Transactions: empty state; same permission behaviour.
5. Listings: not-configured state.
6. Calendar, Documents, Messages, Reports, Notifications: not-configured states, no fixture content.
7. Profile page renders; photo shows; onboarding route behaves as before (Finding C).
8. Command palette opens, searches, closes and returns focus.
9. Assistant surface shows unavailable (no credential) — no error page.
10. Sign-out works.
11. Vercel runtime logs for the window: no 5xx, no unhandled errors.

After Gate C (role approved): create one **real** contact the user intends
to keep, confirm it appears on Home/Search, and leave it. No synthetic rows.

Vercel system mitigations (Security Checkpoint) remain **enabled**. A human
browser passes them normally; if an automated probe is challenged, that is
ISS-09 — known automation/test-infrastructure behaviour, not a Production
blocker — and the check is done by hand instead.

---

## 13. Monitoring (first 72 h, then weekly)

- `/api/health` after each stage and hourly for the first day.
- Vercel runtime logs and errors for the dashboard project: 5xx rate,
  middleware 503s (Clerk config), `[profile-images]` credential lines.
- Neon: `br-bitter-cake-av7pmzth` connections, query errors, storage.
- `audit_events` growth by `event_type` (counts only).
- From Stage 8: OpenAI project spend vs budget, 429 rate, tool timeouts.
- From Stage 9: `ai_prepared_actions` by status (counts only); any duplicate
  `prepared` rows would violate the 0008 index and must not exist.

---

## 14. Remaining issues

| ID | Severity | State | Launch impact |
|---|---|---|---|
| Finding A | gate | only Production user is `member` | writes unusable until a human approves a role (Gate C) |
| Finding B | P2 | unflagged contacts/transactions source is `sample` without notice | neutralised by Gate A; code follow-up recommended |
| Finding C | P3 | Production profile flags not on in certified Preview | Stage 5 profile smoke; optional Preview check |
| ISS-09 | known infra | Vercel Security Checkpoint challenges automation | none; mitigations stay enabled |
| ISS-11, ISS-12, ISS-13 | P3 | cosmetic/minor (see certification doc) | none |
| ISS-05, ISS-06 | accepted | classified in remediation pass | none |
| P0 / P1 | — | none | — |

---

## 15. Operator checklist

Each line is a stop point: do not continue past a failed check.

**Pre-deploy**
- [ ] Human approval of this plan recorded.
- [ ] Certified branch HEAD still `b4c04d0`; `git status` clean; Preview health still as §1.
- [ ] Production still `dpl_5WFnRw8PyQuEm7XpcWBhBYdrNp9M` / `625dc90` (record it — it is the rollback target).
- [ ] Vercel project's Production branch confirmed to be `claude/fortmark-dashboard-build-v39u96`.
- [ ] Vercel system mitigations confirmed enabled; they stay enabled.
- [ ] (Optional, Finding C) Preview profile-flag check done.

**Database**
- [ ] Neon backup branch created from `br-bitter-cake-av7pmzth` (named e.g. `pre-promotion-2026-09-XX`); branch count within plan limit.
- [ ] Migrator run from `b4c04d0` with the Production unpooled connection string; printed branch fingerprint matches Production.
- [ ] §6.3 checks: 9 rows, max `created_at` 1790092212914, hashes match, tables and partial unique index present, user/audit counts unchanged.
- [ ] Current Production (`625dc90`) health/pages still fine after migration.

**Environment**
- [ ] `CONTACTS_DATABASE_ENABLED=1` (Production scope only, encrypted).
- [ ] `TRANSACTIONS_DATABASE_ENABLED=1` (Production scope only, encrypted).
- [ ] `AI_PROVIDER=openai` (Production scope only).
- [ ] Confirmed absent in Production: `AI_CHAT_PROVIDER_ENABLED`, `OPENAI_API_KEY`, `AI_ACTIONS_ENABLED`, `AI_MODEL`, `SAMPLE_DASHBOARD_ENABLED`, `SAMPLE_LISTINGS_ENABLED`, `MLS_LISTINGS_ENABLED`, `BLOB_READ_WRITE_TOKEN`.
- [ ] No other Production variable changed; nothing added to Preview-and-Production shared scope.

**Portal**
- [ ] No change. Portal Production stays `b819667`.

**Dashboard**
- [ ] Fast-forward `claude/fortmark-dashboard-build-v39u96` to `b4c04d0` (`git push origin b4c04d0:claude/fortmark-dashboard-build-v39u96` — a fast-forward; refuse if git reports anything else). Never promote a Preview deployment artifact.
- [ ] Production build log shows the migrator skip line and a clean `next build`.
- [ ] Deployment READY and aliased to Production.

**Health**
- [ ] §10 launch JSON matches exactly (revision = `b4c04d0`, the 7-char SHA).

**Smoke**
- [ ] §12 steps 1–11 pass with an existing allowlisted human user.

**AI**
- [ ] Stage 8 only after its entry criteria; new Production key by a human; redeploy; health `available`; read-only questions answered from real (empty) data; no propose tools.

**Actions**
- [ ] Stage 9 only after its entry criteria; redeploy; one real prepare→confirm and one prepare→cancel by a human; repeat proposal reuses the pending action; audit events present.

**Monitoring**
- [ ] §13 in place for 72 h.

**Rollback**
- [ ] Rollback target and triggers (§11) known to the operator before Stage 3.
- [ ] Instant rollback tested mentally against the target ID; DB restore only by explicit approval.

### Environment change checklist

| Order | Variable | Scope | Type | Value | When | Undo |
|---|---|---|---|---|---|---|
| 1 | `CONTACTS_DATABASE_ENABLED` | Production | encrypted | `1` | before Stage 3 build | only via app rollback, never flag removal |
| 2 | `TRANSACTIONS_DATABASE_ENABLED` | Production | encrypted | `1` | before Stage 3 build | same |
| 3 | `AI_PROVIDER` | Production | encrypted | `openai` | before Stage 3 build | delete (harmless) |
| 4 | `OPENAI_API_KEY` | Production | sensitive | new Production key | Stage 8 | revoke at provider + delete |
| 5 | `AI_CHAT_PROVIDER_ENABLED` | Production | encrypted | `1` | Stage 8 | delete + redeploy / rollback |
| 6 | `AI_ACTIONS_ENABLED` | Production | encrypted | `1` | Stage 9 | delete + redeploy / rollback |

### Migration checklist

| Migration | Pre-state | Post-state check |
|---|---|---|
| 0005 `broad_sumo` | absent | `to_regclass('public.transactions')` non-null; row 6 hash `fce71405…` |
| 0006 `natural_energizer` | absent | `to_regclass('public.contacts')` non-null; row 7 hash `84916237…` |
| 0007 `purple_iceman` | absent | `to_regclass('public.ai_prepared_actions')` non-null; row 8 hash `2e43cf92…` |
| 0008 `loud_warstar` | absent | `pending_key` column + partial unique index; row 9 hash `efab9abe…`; max `created_at` 1790092212914 |

### Rollback checklist

| Stage failed | Do | Don't |
|---|---|---|
| 1 (migration) | read §6.3; if count = 5 nothing applied — fix and re-run; if partial state appears, stop and restore from the backup branch with approval | drop tables by hand |
| 2 (env) | delete the variable you set; running deployment is unaffected | touch any other variable |
| 3–5 (deploy/health/smoke) | Instant Rollback to `dpl_5WFnRw8PyQuEm7XpcWBhBYdrNp9M`; leave schema and flags in place; record why | remove Contacts/Transactions flags; restore the DB |
| 6 (role change) | the transaction either commits one row + one audit event or is rolled back; to revert, run the same statement in reverse with its own audit event | edit the role without an audit event |
| 8 (AI read-only) | Instant Rollback to the Stage 3 deployment; revoke the key if abuse suspected | reuse the Preview key |
| 9 (actions) | Instant Rollback to the Stage 8 deployment | delete `ai_prepared_actions` rows |

---

## 16. GO / NO-GO criteria

| Criterion | Result |
|---|---|
| Migrations compatible with current and certified code | PASS — additive only |
| Production env state known | PASS — full matrix, presence-only for secrets |
| Rollback viable | PASS — instant rollback to a known deployment; schema needs no rollback |
| Portal/dashboard topology compatible | PASS — all four combinations; no portal change |
| No secret leak | PASS — bundle, repo and log scans clean |
| No mock mode in Production | PASS **conditional on Gate A** |
| Clean promotion strategy | PASS — fast-forward + fresh Production build |
| Safe with risky flags off | PASS — AI, actions, MLS, sample off |
| No P0/P1 audit finding | PASS — highest is P2 (Finding B, config-gated) |

**GO FOR STAGED PRODUCTION PROMOTION**, executing §15 in order, only after
this plan is reviewed and approved. This audit did not deploy anything.
