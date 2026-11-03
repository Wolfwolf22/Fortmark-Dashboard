# Launch readiness — 2026-11-03

## Current decision

The user has now explicitly requested the complete local overhaul in Production
using the existing real brokerage data. This supersedes the earlier staging-only
scope. Live route maps are deferred at the user's request. The two named release
resources were separately approved: a fresh Production Neon snapshot and a private
transaction attachment store. Production publication, migration and traffic
promotion remain pending verification below; local tests alone do not certify a
running cloud deployment.

The connected Vercel account lists `fortmark-dashboard`
(`prj_5KVjhWtseC2mnPMkMU35D9F40wQV`) in team
`team_lrHGYzrhpDXRjeAepo6ezt7Q`, alongside the `fortmark-app` portal.
Vercel team authorization is now working. Current cloud metadata was inspected;
the existing deployments predate this overhaul. The live read-only Production ledger and catalog have now been checked. No remote
push or migration has run yet.
The approved private store and fresh snapshot have now been created; configuration
and deployment evidence must be recorded as release work completes.

### Authorized Production release preparation

- Fresh data-and-schema snapshot: `br-proud-waterfall-avarzu8n`,
  `pre-overhaul-production-20261103T0438Z`, from `br-bitter-cake-av7pmzth`.
  Provider console creation time: November 2, 2026, 23:46:06 Eastern; expiration
  **Never**. No migration is applied to this recovery branch.
- Dedicated private Blob store: `store_NSTN5f48IHugiItT`,
  `fortmark-transaction-files-production`, region `iad1`. Its connection uses only
  Production and the `TRANSACTION_FILES_BLOB` prefix; credentials are never copied
  or printed.
- Production database metadata confirms `neondb`, owned by `neondb_owner`.
  The verified endpoint `ep-delicate-morning-avh7x6vk` uses the project's `c-11`
  regional gateway. Its normalized hostname fingerprint is `23deffc7e4e5`,
  matching the currently serving Production build's existing log.
- `deployment-build.mjs` makes the standard Production build invoke the
  production-only release gate before Next. Both injected URLs must independently
  match the fixed provider endpoint/region/database, and the unpooled session must
  be direct. A missing/unknown ledger or schema mismatch stops the release.
- The exact documented migration `0009` CRLF hash is acknowledged explicitly;
  no migration history is rewritten. Other hash/timestamp differences refuse.
- Portal-origin normalization from the preserved middleware hotfix is selectively
  integrated with the current auth model; obsolete branch implementations are not
  merged wholesale.

### Concrete Production execution plan

1. Publish the reviewed `codex/design-identity-foundation` commit. Its committed
   Vercel Git rule suppresses automatic deployment for that exact review branch.
2. Create only two new Production variables: `CALENDAR_DB_ENABLED=1` and
   `TRANSACTION_FILES_ENABLED=1`. Preserve all existing core, MLS, sample and
   routing settings and credentials.
3. Temporarily change `autoAssignCustomDomains` from its observed `true` to
   `false` so the actual Production build cannot take traffic before review.
   Restore the original setting on completion or failure.
4. Build the exact reviewed SHA as an actual Production artifact. The ordinary
   package build runs the pinned endpoint migration gate under one session lock,
   applies the 17 pending journal migrations atomically, verifies all 31 entries
   and current schema, and then runs the approved-store private-file gate. That
   gate creates one 68-byte synthetic PNG at fresh UUIDs, reads and verifies its
   checksum, and removes only its own generated object. It creates no client or
   transaction rows and sends no notifications. Next must then build successfully.
5. Verify the artifact's SHA, release reports and real source health before
   moving traffic. Fast-forward the tracked Production Git branch from
   `4251392e0106e044138eae1fe25ca57c7e7043c2` to the same reviewed SHA with an
   expected-head lease and no force. Stop if another actor changed that branch.
   Any resulting identical build must pass the same gates.
6. Promote the verified immutable artifact, restore automatic Production domain
   assignment, and verify project aliases, portal sign-in, existing Contacts and
   the new Calendar/transaction surfaces through the legitimate signed-in session.

A migration failure rolls back that migration batch. A later file/build failure
leaves the already verified upgraded database in place while the old app continues
serving; the pending schema is compatible with the old app's existing records.
Do not automatically reset the database or discard later user writes. The fresh
snapshot and original deployment are recorded recovery resources. A killed worker
can prevent final synthetic-file cleanup; the build cannot report success without
an acknowledged cleanup. Live Google route maps remain explicitly deferred.

Final local release additions passed: 125 auth/routing checks, 69 isolated atomic
release checks, 65 private-file checks, 40 build-order checks, final typecheck and
actual isolated Next production compilation. The 122 previously configured
regression commands passed across two runs (the sandbox-only loopback failure was
resumed with loopback permission); the new private-file command then passed
separately. These are local checks, not certification of the forthcoming live
migration/provider/deployment.

Historical certification aliases, branch IDs and migration counts are reference
material only. Read the current target metadata before deployment; do not reuse
an older certificate as proof of current isolation or readiness.

## Current cloud evidence and remaining gates

Metadata was read without decrypting environment values or retrieving credentials.
GitHub repository metadata and current Production deployment metadata agree:
`Wolfwolf22/Fortmark-Dashboard` backs the `fortmark-dashboard` Vercel project;
`Wolfwolf22/fortmark-app` backs the separate `fortmark-app` portal project. The
local overhaul checkout points at `Wolfwolf22/Fortmark-Dashboard`. The portal
serves the sign-in/account shell and routes `/dashboard` to the dashboard zone.

| Item | Verified state | Remaining release gate |
|---|---|---|
| Dashboard Production | READY `dpl_nNbkQFufg9N2U7cMBdkmfZmHiTVQ`, commit `4251392e0106e044138eae1fe25ca57c7e7043c2`, tracked branch `claude/fortmark-dashboard-build-v39u96` | Stage and promote the exact reviewed overhaul; fast-forward the tracked branch to the same commit |
| Portal | `fortmark-app`, `prj_zTxYdq9NBt9UMKy3ICOaCaV54Q9o`, Production commit `63b519b4ae71a8854137ad677aadfb88c112e2b1` | Existing legitimate portal session successfully opens real Contacts; verify again after promotion |
| Real sources | Existing `/dashboard/api/health` reports contacts/transactions `db`, listings `mls`, homeMetrics `real-only` | Preserve these current settings; verify serving revision and new sources after release |
| Production database | Actual endpoint `ep-delicate-morning-avh7x6vk`, `neondb`, role `neondb_owner`; read-only repeatable-read metadata check at `2026-11-03T05:02:36Z` | Apply guarded committed migrations during the actual release build |
| Migration history | 14 applied, 31 committed, 17 pending. All match the repository except the exact known migration0009 CRLF hash. No unknown entry | Verify full ordered ledger and schema after atomic upgrade |
| Legacy workspace | All five column names, types and nullability match migration0014; 18 existing tables, 246 columns, 123 enum labels exported without business records | Keep workspace JSON and ownership unchanged |
| Calendar | `CALENDAR_DB_ENABLED` absent | Enable exact Production value `1` for the new persisted Calendar |
| Private transaction files | Approved private store `store_NSTN5f48IHugiItT` connected Production-only with dedicated sensitive token and store-ID metadata | Enable `TRANSACTION_FILES_ENABLED=1`; verify one generated synthetic PNG round trip and cleanup during the actual build |
| Live routes | Google Maps credentials absent; user explicitly deferred live routing | Keep disabled |

The signed-in console was used for metadata-only SQL in an explicit read-only
transaction ending in `ROLLBACK`. Local release evidence contains ledger and
system-catalog exports; no application records or credentials were exported.
The Neon plugin account mismatch was not bypassed by copying a database secret.

### Signed-in Neon console observations

The following identities were read from the console on 2026-11-02 without opening
connection strings, querying tables, unarchiving branches or changing settings:

| Branch | ID | Parent | Compute |
|---|---|---|---|
| `main` (default) | `br-lucky-boat-avuciz2l` | None shown | Not inspected |
| `production/fortmark-professional-profiles` | `br-bitter-cake-av7pmzth` | `main` | One Primary, `ep-delicate-morning-avh7x6vk`, suspended |
| `preview/claude/dashboard-status-yir55p` | `br-crimson-smoke-avlj2rmp` | `main` | One Primary, `ep-blue-river-avha0z9g`, suspended; branch archived 2026-10-04 |

At initial inspection the project had ten branches and displayed **Branch limit
reached**. Eight were archived, including three older Preview branches and five
historical safety branches. After the user explicitly confirmed the exact
permanent deletion, `preview/feature/profile-onboarding-wizard`
(`br-muddy-sunset-avuvj0h9`, archived since 2026-08-26) was deleted on 2026-11-02.
The resulting console inventory initially showed **nine branches**, with one slot free.
The separately approved fresh Production snapshot now occupies the tenth slot.
`main`, Production, all five historical safety branches and the two other Preview
branches remain. The Git code branch was not deleted. No reset, unarchive or plan
upgrade was performed.
The observed old Preview branch's linked Vercel deployment is an older deployment;
its existence does not bind the current candidate's effective Preview variables.

The Neon native integration's **Production branch** selector currently shows
`main`. Vercel's manual Production database variables therefore remain a distinct
binding to verify rather than assuming that selector describes the application.
The two manual Vercel Production variable rows were last updated on 2026-08-04.
The current Production deployment's existing build log reports host fingerprint
`23deffc7e4e5`, matching the historical audited Production branch fingerprint.
Together these support continuity with `br-bitter-cake-av7pmzth`; the fresh read-only Production query additionally verifies the actual database,
role, ledger and catalog. Preview resources are outside this release.

## Fixes included

- Removed invalid Calendar and Transactions Page exports that passed ordinary
  TypeScript checks but failed Next.js production Page validation.
- Reauthorized private checklist/vendor downloads against the current actor and
  parent transaction in the final metadata query before returning file bytes.
- Hardened transaction/workspace reads, vendor directory/receipt returns and
  checklist setup/default reads against late role, status and ownership changes.
- The global New menu now follows server-provided source capabilities and the
  caller's role. Unconfigured listing publishing and global document creation
  no longer present forms that cannot succeed. Direct entries explain the
  appropriate source workflow.
- Contact creation retains its exact submitted fields and request UUID when the
  response is unconfirmed, including across closing/reopening the dialog.
  Checking the saved result recovers the same request rather than duplicating it.
  The dialog stays mounted across role/capability refreshes while authorization
  still hides private fields and refuses writes when access is withdrawn.
- Retired the legacy personal-workspace setup script's direct-DDL path. Normal
  deployment builds use the committed atomic migration runner.
- Added a network-blocked, secret-free production-build verifier and explicit
  target checks for a future operator-invoked staging smoke run.
- Public health output now reports coarse Calendar source selection and private
  transaction-upload configuration. It returns no records, counts, credentials
  or database identity, and it is not a database reachability certificate.

## Local verification

| Boundary | Evidence | Limit |
|---|---|---|
| Production compilation | Actual Next.js build in a disposable snapshot, including generated Next types and prerendering | Synthetic auth, providers disabled; no authenticated staging runtime |
| Migration upgrade | Populated original schema upgraded through migrations0015–0030; failure rolls back the entire batch | Isolated PostgreSQL engine, not the live Neon transport |
| Saved client workflow | Actual adapters → actual route handlers → actual services → disk-backed PostgreSQL; database closed and reopened | Session/DB binding and MLS are synthetic, no real Clerk or MLS integration |
| Permissions and files | Forced late ownership, role and status changes before final reads/receipt return | Private storage provider is injected, not a live Blob upload |
| Creation and recovery | Rendered capability/role gates, exact contact receipt replay and closed-dialog recovery | Does not activate any live account or integration |
| Source observability | Actual health handler verifies independent Calendar flags and explicit private upload selection | Configuration selection only |
| Regression suites | Configured repository regression commands passed across segmented runs; closed preview sessions rerun separately | Do not replace deployment verification |

Focused release checks passed: migration chain 33, persisted client journey 48,
file authorization 20, creation/recovery 24, health 13, launch-target preflight 39,
production-build safety 25 and read-only staging DB preflight 61. Contacts V3's
325 checks passed after updating two stale source assertions. Final additions are
recorded in the accompanying local release report. The isolated production build
records its application-source digest and checks that it still matches the
working runtime source at completion. `test:migrate` was explicitly skipped
because native PostgreSQL server binaries were unavailable; it provides no live
Neon or native-migrator certification.

All 17 closed preview session suites passed again (248 synthetic scenario groups).
The local browser check confirmed that the New menu exposes Contact, Transaction
and Calendar item in the configured preview. The separate sample banner states
that changes stay in memory. This is visual evidence, not a cloud persistence run.

## Historical staging procedure (superseded by the authorized Production release)

1. Recheck the authorized Vercel connection for the identified team. Read the
   dashboard and portal project configuration, production branch, current
   deployment revisions and target environment mappings. Do this before a Git
   push or deployment: Preview builds can apply migrations automatically.
   Disabling application source flags does **not** disable that migration guard.
   An initial provisioning deployment to an unverified target must explicitly
   omit the migrator in its deployment-scoped build command; changing source
   flags alone is insufficient. Do not change Production build settings.
2. Confirm the staging database is a separate branch/resource from production,
   private transaction files use a separate private Blob store, and staging uses
   a development Clerk instance with approved synthetic Agent/Admin/Member users.
   Verify the actual resource IDs; names and attestation flags alone are not proof.
3. Record a restore point for the exact staging database branch and the tested
   application fallback artifact. Keep production untouched. Do not export real
   client data or print connection strings, provider tokens or session material.
4. Apply the committed migration journal only to that verified staging target.
   Verify the resulting journal hashes and current schema with the read-only
   staging database preflight. A successful build log or a table count alone is
   not a schema verification.
5. Deploy the exact reviewed candidate to the verified nonproduction target.
   Confirm the serving revision and source selections through `/dashboard/api/health`.
6. Through the portal and a legitimate development Clerk session, create only
   namespaced synthetic records. Verify contact → research list → showing/tour →
   transaction/checklist/vendor → calendar, refresh persistence, and private
   role boundaries. Verify private file upload/download and the approved MLS
   read path only against confirmed staging resources. Do not send messages,
   calendar invitations or notifications to real people.
7. Check failure/retry behavior and remove only the disposable fixtures created
   for this run. Record the actual deployment IDs, migration hashes, resource
   isolation evidence and remaining integration limitations.
8. Approve a small private pilot only after those live gates pass. Production
   promotion remains a separate release decision.

## Safe operator commands

```sh
npm test
npm run build:verify-isolated
npm run test:launch-migration-chain
npm run test:launch-journey
npm run test:transaction-file-readiness
npm run test:launch-health
npm run test:launch-preflight
npm run test:staging-db-preflight
```

After the isolated target and restore point are independently confirmed and its
migrations have been applied, supply credentials through the approved operator
environment and run the read-only schema check:

```sh
npm run staging:db:check -- --target staging \
  --expected-db-host <isolated-database-host> \
  --production-db-host <production-database-host>
```

That check validates all current migration hashes/timestamps and schema metadata
in a read-only transaction. It rejects missing, mismatched, pooled/unpooled
disagreement and production-equivalent targets before connecting. It does not
print hosts, connection strings or records, and does not apply migrations. Its
schema manifest covers tables, columns, nullability and enums; it is not a complete
constraints/index/trigger drift audit.

The prepared `playwright.launch.config.ts` has no default remote target, refuses
the known Production origins and custom hosts, requires explicit
isolated-database/synthetic-write attestation and development Clerk configuration,
and disables traces, video and
screenshots that could capture a session. It is prepared tooling, **not a run
that has been performed**. An otherwise accepted `*.vercel.app` hostname is not
proof of a Preview deployment. Target environment, revision and actual database
branch metadata must be independently verified first. Comparing database hosts
alone cannot rule out another endpoint on the same Neon branch.
Historical certification configs retain their original assumptions and must not
be used as the current launch gate.

## Rollback constraints

The migration runner is transactional. A failed pending batch and its bookkeeping
roll back together. A successful schema upgrade is not reversed by an application
rollback; do not drop migrated tables to undo a UI release.

A fallback application must understand `gc`/`general_contractor` records before
those records exist in the target database. A pre-GC build can misrepresent those
files as sales. Select and test a compatible fallback, or keep GC writes disabled
and prove the fallback's behavior. Keep calendar/source flags and sample flags
explicit; never hide a failed real source behind fabricated brokerage data.

## Deliberately deferred

General contractor files remain blank beyond their configured property/client
shell. Google/Outlook sync, AI property presentations, the separate global document
library and messaging/notifications are not certified integrations in this release.
The assistant, MLS and private storage require their own current credential and
runtime verification; no paid provider was activated by the local checks.
