# FortMark Dashboard

The FortMark brokerage workspace: authenticated contacts, property research,
showings and saved tours, transaction files, private calendar items and color labels.
It is a Next.js dashboard zone served under `/dashboard` through the FortMark portal.

## Start here

- [Launch readiness](docs/LAUNCH_READINESS.md): current evidence, remaining staging gates and rollout order.
- [Deployment architecture](docs/DEPLOYMENT.md): portal rewrite, Clerk and environment scoping.
- [Internal calendar](docs/internal-calendar.md): personal items, source schedules and private color labels.
- [Design system](docs/DESIGN-SYSTEM.md): shared visual foundations.

Historical certification documents record the revisions named in those documents.
They do not certify the current overhaul or the current state of a cloud deployment.

## Local development and review

Use Node.js 22 or newer and install the committed lockfile:

```sh
npm ci
npm run typecheck
npm test
```

For the closed synthetic design preview:

```sh
node tools/design-preview/server.mjs
```

Open `http://127.0.0.1:4173/preview?view=%2Fcalendar&scenario=interactive`.
The preview uses memory only. Reload discards its sample changes, and it cannot
write to an account, database, MLS, calendar provider or file store.

For the real application, configure a separate development Clerk instance and
approved development resources using the names in `.env.example`, then use
`npm run dev`. Next.js loads the local environment files; standalone operator
scripts require their environment to be supplied explicitly. Never commit values.

## Build verification

```sh
npm run build:verify-isolated
```

This verifies a real Next.js production build in a disposable source snapshot.
It uses synthetic public auth configuration, blocks network access and excludes
secret environment files. Dependencies and the Clerk prebuild patch are isolated
from the working checkout. This is a compile check, not staging certification.

`npm run build` is the deployment build: it invokes the migration guard before
Next.js. A Preview build can apply migrations. Verify the exact project,
branch, isolated database and restore point before pushing or deploying a branch
that can trigger that command. Production promotion is a separate release step.

The legacy `FM_PERSONAL_WORKSPACES_SETUP` direct-DDL path is retired. Workspaces
are created through the normal committed migration journal with the other tables.

## Backing services and configuration

- Clerk protects the dashboard and API routes. Brokerage identity and roles
  control database access; private calendars, property lists and tours retain
  owner scope even for Admin.
- `PROFILE_DATABASE_ENABLED` enables the shared database identity. Contacts and
  Transactions have their own source flags. `CALENDAR_DB_ENABLED` independently
  enables personal items and labels after migration 0030.
- Listings are read from the configured MLS feed. New listings are entered in
  the MLS. The dashboard does not publish a listing to that feed.
- Checklist and vendor evidence use a dedicated **private** Blob store and
  explicit upload flag. The separate global Documents library remains unconfigured.
- Source-backed calendar entries update their original showing, next action or
  transaction deadline. Personal entries and labels are stored privately.
- The assistant and external providers have separate opt-in flags. Messaging,
  external calendar sync and other unconfigured integrations are not implied by
  the dashboard UI.

Sample data is permitted only through explicit sample configuration and labelled
preview surfaces. Production should use real sources or an honest unavailable state.
The global New menu exposes only creation actions backed by the caller's role and
configured source; unavailable direct entry points explain where the work belongs.

## Verification boundaries

`npm test` covers pure decisions, real isolated PostgreSQL migrations and service
queries, HTTP handlers, adapters, rendered components, privacy and recovery paths.
The launch journey additionally closes and reopens its disposable persistent
PostgreSQL database to verify saved state across the client workflow.

The isolated production build and closed design preview add compilation and visual
evidence. A real staging release must still verify current cloud resource isolation,
apply and verify its journal, sign in as approved synthetic roles, test persistence
through the portal/API, and exercise the approved private file and MLS integrations.
Those live checks cannot be replaced by local tests or an older certification report.
