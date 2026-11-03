# Launch readiness — 2026-11-02

## Current decision

The overhaul is being prepared for an isolated staging validation. Local tests,
a real Next.js production compile and a persistent client-journey rehearsal are
release evidence. They do **not** certify the current cloud environment.

The connected Vercel account lists `fortmark-dashboard`
(`prj_5KVjhWtseC2mnPMkMU35D9F40wQV`) in team
`team_lrHGYzrhpDXRjeAepo6ezt7Q`, alongside the `fortmark-app` portal.
Vercel team authorization is now working. Current cloud metadata was inspected;
the existing deployments predate this overhaul. Staging resource isolation and
live migration state remain unverified. No remote push, deployment,
configuration change, live database write or live storage operation was performed.

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

| Item | Verified state | Required before staging writes |
|---|---|---|
| Dashboard production | READY deployment `dpl_nNbkQFufg9N2U7cMBdkmfZmHiTVQ`, commit `4251392e0106e044138eae1fe25ca57c7e7043c2`, branch `claude/fortmark-dashboard-build-v39u96` | Leave unchanged |
| Dashboard latest Preview | READY deployment `dpl_GMURJBzZp1o6kEKBkdW1DBhrP1GT`, commit `ab24bcde07dc8869b8b3aad84be66c2d184fec89` | Deploy and verify the exact reviewed overhaul only after isolation |
| Portal | Existing project `fortmark-app`, `prj_zTxYdq9NBt9UMKy3ICOaCaV54Q9o`; Production commit `63b519b4ae71a8854137ad677aadfb88c112e2b1` on `main`; Preview metadata readable | Verify a compatible nonproduction portal and development identity flow |
| Neon integration | Store `store_xGLbAY6ruochCguv`, external project `misty-cherry-08153356`, attached to both Preview and Production | Independently verify actual branch/endpoint mappings and Production's manual URL override; attachment alone proves neither sharing nor isolation |
| Direct Neon connection | Connected, but project listing returns no projects, including its visible organization; the known FortMark project/endpoint requests return `UNAVAILABLE` | Connect the owning account or grant this connection access to the existing project |
| Calendar | No `CALENDAR_DB_ENABLED` environment entry found | Explicit Preview configuration after migrations and resource verification |
| Transaction files | No `TRANSACTION_FILES_ENABLED` or dedicated `TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN` entry found; only a profile-image Blob store is connected to Preview | Dedicated private transaction store/token scoped to the verified nonproduction target |
| MLS | No Preview `BRIDGE_API_TOKEN` entry found; provider flag values were not read | Confirm an authorized Preview MLS read configuration |
| Authentication | Clerk key entries exist; values were not read | Verify development instance and approved synthetic role accounts |

The direct Neon account's empty listing is an access gap, not evidence that the
Vercel-managed database was deleted. Do not create a replacement or deploy to a
possibly shared database to work around it. Old aliases and branch IDs remain
historical evidence only.

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

## Staging rollout order

1. Recheck the authorized Vercel connection for the identified team. Read the
   dashboard and portal project configuration, production branch, current
   deployment revisions and target environment mappings. Do this before a Git
   push or deployment: Preview builds can apply migrations automatically.
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
