# CRM follow-up + page-heading fix — Production promotion audit

Audit only. Nothing was deployed, no Production branch was pushed, and Production
(database, environment, deployment) was only read.

No secrets and no real customer information are in this document.

## Decision

**GO FOR SMALL PRODUCTION PROMOTION** — subject to human authorization, and to
the operator's own Production smoke (§9), which I cannot run.

## 1. Certified source

| | |
|---|---|
| **CERTIFIED_RUNTIME_REVISION** | `a221c21` |
| Preview deployment of it | `dpl_5vPpLbSBuJvAm2bqX9jDr3BmuH9H` (READY) |
| Later commit `2d36b8a` | Documentation, e2e specs and `playwright.config.ts` only. **Runtime-identical** to `a221c21` (verified: no change under `app/`, `components/`, `lib/`, `package.json`, `next.config`, `middleware.ts`) |
| Follow-up feature commits | `e418eea` → `fce9de7` → `b85a871` (design and drawer copy) |
| Heading fix | `a221c21` |

**Cleanest promotable revision: `a221c21`.** It is the last commit that changes
runtime; everything after it is test/docs. Promote `a221c21`, not "the newest".

The Production branch is `claude/fortmark-dashboard-build-v39u96` at `f39c0dd`,
and `f39c0dd` is an ancestor of `a221c21`, so promotion is a **fast-forward**
with no merge, no cherry-pick and no conflict. The commits between
(`026a6ce`, `e418eea`, `89e0969`, `fce9de7`, `b85a871`, `32bcac6`) are the
follow-up work plus e2e specs and docs.

## 2. Current Production (read-only, no drift)

| | |
|---|---|
| Revision | `f39c0dd` |
| Deployment | `dpl_7piwwZL9G17nn7LsVs1bxByv3UmQ`, READY, target production, aliased to `fortmark-dashboard.vercel.app` |
| Health | 200, `Cache-Control: no-store` |
| Sources | `contacts=db` · `transactions=db` · `listings=mls` · `homeMetrics=real-only` |
| AI | provider `openai`, status `no_credential` |
| Actions | `disabled` |
| Bridge | listings served from MLS (`listings=mls`); credential untouched, never read |
| Migration level | 11 applied (repo has 11: `0000`–`0010`), no drift |
| Counts | 1 contact · 6 activities · 0 transactions · 0 deadlines · 1 user · 1 profile · 1 brokerage identity · 1 MLS link · 0 prepared actions |

Identical to the Master Checklist baseline; no material drift, so the audit continues.
Production was not modified by this audit.

## 3. Human Production check

The operator states they verified Production manually. I cannot confirm the
items independently and have not manufactured a session:

| Item | Status |
|---|---|
| Normal sign-in | operator-reported; **HUMAN CHECK REQUIRED** to record |
| Home correct | operator-reported; **HUMAN CHECK REQUIRED** |
| FortMark Listings count = Home | operator-reported; **HUMAN CHECK REQUIRED** |
| My Listings correct | operator-reported; **HUMAN CHECK REQUIRED** |
| Exact MLS search in ⌘K | operator-reported; **HUMAN CHECK REQUIRED** |
| Profile / Team / Brokerage settings | operator-reported; **HUMAN CHECK REQUIRED** |

Independent evidence: health above, the anonymous refusal behaviour, and the
unchanged database counts. Because this release touches none of those areas
(§6), a recorded confirmation is a baseline, not a gate on the code.

## 4. Functional delta (18 runtime files, 0 unexplained)

Between `f39c0dd` and `a221c21`, runtime code:

| Area | Files | What changed |
|---|---|---|
| **Follow-up: endpoint** | `app/api/contacts/[id]/follow-up/route.ts` (new) | POST `schedule {day}` / `complete`; `private, no-store` on every response |
| **Follow-up: service** | `lib/contacts/service.ts`, `domain.ts`, `http.ts` | `changeFollowUp` (update + audit in one `db.batch`); `logActivity` gains keep / set / complete rule and date check; `invalid_date` → 400 |
| **Follow-up: rule** | `lib/contacts/follow-up.ts` (new), `lib/metrics/business-day.ts` (new) | one classifier; America/New_York business day |
| **Follow-up: UI** | `components/leads/lead-drawer.tsx`, `leads-table.tsx`, `lead-shared.ts` | Next-follow-up region, log-a-touch form, Follow-up column, "No touch in 14 days" |
| **Follow-up: client adapters** | `lib/data/adapters/leads.ts`, `lib/data/sample-leads.ts`, `sample-metrics.ts` | client calls; the sample set is unreachable in Production (`contacts=db`) |
| **Home** | `lib/contacts/metrics.ts` | Needs-attention uses the shared classifier and boundary (same query shape) |
| **Transactions** | `lib/transactions/close-date.ts` (new), `domain.ts`, `service.ts`, `components/layout/quick-create-dialog.tsx` | blank close date stays blank; an entered day yields exactly one Closing deadline via `initialDeadlines` |
| **UI: display fixes** | `lead-drawer.tsx`, `lib/contacts/http.ts` | drawer subtitle separator; "Unnamed agent" fallback (the caller's own name, never an email or id) |
| **Accessibility** | `components/layout/app-shell.tsx` | hidden `h1` on every section except Home and onboarding |

Non-runtime (not promoted as behaviour): `e2e/*`, `docs/*`, `scripts/test_*`, the
`package.json` **scripts** (two new `test:*` entries; **no dependency change**).

## 5. Database and migration

**NO MIGRATION REQUIRED.** No file under `lib/db/` changed; `git diff` shows no
schema, SQL, journal or snapshot change; dependencies are unchanged. Storage is
still `contacts.next_follow_up_at` (timestamp), written at noon UTC of the picked
day. Migration level stays 11.

## 6. Non-regression

| Area | Result |
|---|---|
| **MLS** | UNCHANGED. No change in `lib/mls`, `lib/mls-identity`, `app/api/listings`, `components/listings`, `components/home`, search, or the command palette. Bridge configuration, token handling, member link, office matching, address privacy, display exclusion, media and comparables are all untouched. |
| **Auth** | UNCHANGED. No change to Clerk configuration, `authorizedParties`, the allowlist, `middleware.ts`, `lib/auth`, the role model or brokerage isolation. |
| **AI** | UNCHANGED. `lib/ai`, provider, model, tool registry, action setting and system prompt are all untouched. Actions remain disabled in Production. |
| **Environment** | NONE required. `lib/flags.ts`, `vercel.json`, `next.config.*` unchanged. |
| **Sample/mock state** | Production flags (`contacts=db`, `transactions=db`, `homeMetrics=real-only`) are read from the environment, which this release does not touch. Mock-leak suite 61/61. |
| **Search / Team / Brokerage / Profile** | UNCHANGED (no files). |

## 7. Data compatibility

Production has one real contact. Read-only inspection (timestamps only, no names):

- `next_follow_up_at` is **NULL** → classified "none": no Follow-up chip, no Needs-attention item, no fake attention.
- `last_contact_at` is set and untouched by any new path; the "No touch in 14 days" heuristic reads only it.
- 6 existing activities (status changes, a note, a system row) are unaffected: the new code writes none on a follow-up-only change.
- 0 rows have a follow-up at any hour other than noon UTC (there are none set). The AI action already stored noon UTC, so future data agrees with the convention.
- The stage, source, assignment and opportunity fields are not read differently.

Nothing is rewritten and nothing is back-filled.

Edge to be aware of (documented, not a blocker): a follow-up stored at an instant
near UTC midnight would classify by its New York day. None exist in Production,
and neither the app nor the AI action ever writes one.

## 8. Timezone

- **CRM follow-up business day = fixed:** America/New_York, DST-safe (23-hour and
  25-hour days tested). Home's Needs-attention, the Leads column and the drawer
  all answer through the same classifier, so they cannot disagree.
- Storage is unchanged (noon UTC of the picked day, the same calendar day in every
  US timezone). This is a classification and display change only.
- Appropriate for Core V1: FortMark operates in South Florida, and there is no
  per-user or per-brokerage timezone in the schema. The constant becomes a
  per-brokerage setting when another timezone joins.
- **Known debt, not fixed here (M-12):** metric windows, transaction deadlines and
  the AI follow-up date validator still reason in UTC days. This release does not
  claim that "all dates are fixed".

## 9. Direct follow-up API

| Check | Result |
|---|---|
| Authentication first | `requireCaller` before anything else (401 otherwise, `no-store`) |
| Actor and brokerage resolved server-side | yes: `resolveActor` from the Clerk id; no caller-supplied actor or brokerage |
| Authorization before semantic validation | **PASS WITH NOTE.** The body's *shape* is validated (400) before the actor lookup, as in every other contacts route, and reveals nothing about any record. Everything that depends on data (existence, ownership, date) is decided after authorization: out-of-scope → 404, read-only → 403, then `invalid_date` |
| Foreign brokerage / other agent | out-of-scope rows are 404, byte-identical to a nonexistent id (role matrix, 5 roles × 14 checks in Preview) |
| Member | 403 on every write |
| Agent | own records only; a colleague's is 404 |
| Privileged (admin / broker / coordinator) | all brokerage records |
| Atomicity | contact update + audit row in one `db.batch` (a real Neon transaction); a forced failure of either statement leaves neither (atomicity suite, 48 checks, transactional stand-in) |
| Fake activity | none: a direct change writes no activity row |
| `last_contact_at` | never written by the direct path |
| No-op | an unchanged day writes nothing (no audit line either) |
| Cache | `private, no-store` on every branch (200/400/403/404/409/500) |
| Audit metadata | contact id, field, outcome, mechanism — never the date, name or any contact detail |

Note: the drawer's name fallback may call Clerk (`currentUser()`) — lazily and
only when a contact the caller owns has no profile name, with any failure
swallowed. It never returns an email or id. In Production the caller's profile
has a name, so the call is not expected.

## 10. Existing touch flow

Backward compatible for every in-repo caller. `POST /activities` still accepts
`{kind, summary, occurredAt?, opportunityId?, nextFollowUpAt?}`; it still creates
the activity and advances `last_contact_at` (a backdated note still cannot move it
backwards). New: it keeps the follow-up unless a new date or
`completeFollowUp` is given; a *past* `nextFollowUpAt` is now refused
(400 `invalid_date`) — previously accepted. The only in-repo caller is the
drawer, changed in this same release; the AI follow-up action uses its own
service. Both paths share `decideFollowUp` and cannot disagree.

## 11. Home, Leads, quick-create, heading

- **Home:** Needs-attention SQL keeps its shape, only its boundary
  (`followUpDueBy`). Open-pipeline stage filter (lost/archived not chased) is
  untouched. No redesign. With a null follow-up nothing appears.
- **Leads list:** Follow-up column handles none (—), overdue and due-today (warning
  pill), and future (date). Sortable, none last. The table sits in an
  `overflow-x-auto` wrapper, so a wider table scrolls inside itself and never the
  page. The 390 px drawer fit is asserted in Preview; the table at narrow widths is
  a visual check in the smoke (§13).
- **Quick-create:** blank close date stays blank and creates **no** Closing
  deadline; an entered day is stored exactly (noon UTC) with exactly **one**
  Closing deadline. Pure code on the create path; **no existing transaction is
  read or rewritten** (Production has 0 anyway, but the change does not depend on
  that).
- **Heading:** `PageHeading` renders a visually hidden `h1` from the same table the
  navigation reads. Home (its hero is the `h1`) and unknown routes such as
  onboarding (own `h1`) are exempt; the access-denied screen replaces the shell, so
  it cannot double. AI markdown headings map to `h3`, and the listing detail's
  address is an `h2` beneath the section `h1`. Exactly one `h1` was asserted on 10
  routes in Preview. No layout change (`sr-only`).

## 12. Build, secrets, cache, rollback

| Check | Result |
|---|---|
| Build of `a221c21` in a clean worktree, with the Bridge, OpenAI, Anthropic and database variables unset | compiled; the new route is listed |
| Offline suites at `a221c21` | `npm test` 18 suites all green (dashboard 90, profile 1141, assistant 92, AI tools 148, providers 113, AI actions 247, MLS 225, transactions 168, contacts 92, follow-up 155, atomicity 48, metrics 100, mock-leak 61, search 64, team 30, brokerage 98, MLS identity 112, shell 42) |
| Client bundle (95 static files) | 0 hits: `sk-ant-`, database URLs, Stripe-style keys, Blob tokens, bearer tokens, JWTs. Server-only variable **names** (`BRIDGE_API_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `FORTMARK_MLS_OFFICE_ID`) appear in 0 files. `CLERK_SECRET_KEY` appears once, inside the Clerk vendor chunk as a `process.env` property reference with no value — unchanged vendor code. Nine loose `sk-` matches are CSS classes (`mask-…`, `task-…`); none begins a token |
| `NEXT_PUBLIC_` | only `APP_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SIGN_IN_URL` — public by design |
| Route cache | new route `private, no-store`; `force-dynamic`; `nodejs` runtime |

**Rollback.** Application-only: re-promote `dpl_7piwwZL9G17nn7LsVs1bxByv3UmQ`
(`f39c0dd`, READY) via Vercel instant rollback. No database rollback is needed
because there is no migration. The old app reads everything the new code writes:
follow-ups at noon UTC classify to the same day by UTC, and the extra audit
metadata keys are a JSON object it ignores. (I could not confirm the deployment's
"rollback candidate" flag through the listing tool, which did not return this
project; confirm in the Vercel dashboard before promoting.)

## 13. Promotion strategy, health expectation, smoke

- **Strategy:** a fresh Production build from the tree at `a221c21` via the
  Production branch fast-forward, not a promotion of the Preview deployment
  object. No environment variable, Bridge, AI or schema change.
- **Post-deploy health, expected:** `contacts=db`, `transactions=db`,
  `listings=mls`, `homeMetrics=real-only`, assistant `no_credential`,
  `actions=disabled`; **only `revision` changes**, to `a221c21`. Any source change → stop and roll back.
- **Human smoke (operator):** 1 Home · 2 Leads (new Follow-up column; check at a
  narrow width) · 3 open the existing contact and look at the "Next follow-up"
  region · 4 Transactions · 5 Listings · 6 My Listings · 7 FortMark Listings ·
  8 ⌘K, including an exact MLS search · 9 Team and Brokerage settings · 10 Tab to the
  "next heading" on any non-Home page and hear the section name.
- **Optional, operator-controlled mutation** (never automated): on the existing
  contact, schedule a *future* follow-up. Expect the follow-up to change, **last
  contact not to change**, no new activity row, one audit row. Then optionally
  complete it. Do not do it unless you choose to.
- **Later monitoring:** 5xx, 503, database errors, contact-route and home-metrics
  errors, Bridge errors. MLS should be unaffected. I could not retrieve
  Production runtime logs during this audit (the log query timed out twice; I
  stopped after the retry limit). The earlier log review (through Sep 28: 401, 200
  and 307 only, no 5xx) and today's live health probe are the evidence; the traffic
  is thin.

## 14. Not in this release (backlog, unchanged)

M-02 `%`/`_` in contact search · M-03 Team email visibility · M-04 unknown stage
filter ignored · M-05 GET on the search route cache header · M-06 router-state 500s
(platform) · M-07 duplicate listing-source request · M-08 single-brokerage
isolation · M-09 close-without-price debt · M-10 Transaction deadline add / edit /
complete · **M-12 transaction and metric windows still on UTC days**.

## 15. Findings

- **P0:** none
- **P1:** none
- **Production blockers:** none
- **Notes (not blockers):** shape-before-authorization ordering on the new route
  (§9); a past `nextFollowUpAt` on `/activities` is now refused (§10); Production
  runtime logs unavailable to me this session (§13); Vercel rollback-candidate flag
  unconfirmed (§12); the six human Production checks are operator-reported (§3).

## 16. Recommendation

Ready for **human authorization** to run a small, code-only Production promotion:
fast-forward the Production branch to `a221c21`, then run the smoke above. Stop
and roll back to `dpl_7piwwZL9G17nn7LsVs1bxByv3UmQ` on any source-state change or
5xx.

---

# PRODUCTION EXECUTION

Executed 2026-09-29, after the audit above was approved.

| | |
|---|---|
| Source | `a221c21` |
| Previous Production | `f39c0dd` · `dpl_7piwwZL9G17nn7LsVs1bxByv3UmQ` |
| Action | Production branch `claude/fortmark-dashboard-build-v39u96` fast-forwarded `f39c0dd` → `a221c21` (plain push; no merge, no force, no conflict) |
| New deployment | `dpl_JDgtuMgnyZmb2mN5TtLeBcNzWvPn` — built fresh by Vercel from the branch, target production, **READY** (created about 15:06 UTC, ready about a minute later), aliased to `fortmark-dashboard.vercel.app` |
| Rollback target | `dpl_7piwwZL9G17nn7LsVs1bxByv3UmQ` — verified READY and previously live before the push; **not needed** |

## Gates before the push

Rollback target READY · health identical to the audit (`f39c0dd`, `contacts=db`,
`transactions=db`, `listings=mls`, `homeMetrics=real-only`, `no_credential`,
`actions=disabled`) · Production branch tip still `f39c0dd` (clean fast-forward) ·
delta re-verified: 18 runtime files, **0** files under `lib/db`, `lib/mls`,
`lib/mls-identity`, `lib/auth`, `lib/ai`, `lib/flags.ts`, `middleware.ts`,
`next.config.ts`, `vercel.json`, `package-lock.json`; `package.json` changes are only
two `test:*` script entries.

## Health gate (after)

`GET /dashboard/api/health` → 200, `no-store`:
`revision=a221c21`, `transactions=db`, `contacts=db`, `listings=mls`,
`homeMetrics=real-only`, assistant `openai` / `no_credential`, `actions=disabled`.
**Only `revision` changed.**

## Unauthenticated safety

- `/dashboard`, `/leads`, `/transactions`, `/listings`, `/settings` → 307 to the sign-in page, with the return path; no loop.
- `/dashboard/api/{contacts,metrics,transactions,team,brokerage,listings}` → 401, `no-store`.
- The new `POST /dashboard/api/contacts/<id>/follow-up` → 401, `no-store` (refused before anything else).
- No 5xx observed on any probe; no record data exposed.

## Database (read-only, after)

Migrations **11** (unchanged) · contacts **1** · activities **6** · transactions **0** ·
deadlines **0** · users 1 · profiles 1 · brokerage identities 1 · MLS links 1 ·
prepared actions **0** · contacts with a follow-up **0** · audit events in the last
30 minutes **0**. Nothing changed: the deployment wrote nothing.

## Logs

The runtime-log tool available to this session is bound to a different Vercel
project, so it could not return this project's logs (a grouped query for the new
deployment came back empty, and earlier queries timed out). This is **not**
evidence of a clean log. The evidence in hand: the probes above (200 / 307 / 401
only), health after the build, and unchanged database counts. **Check the
dashboard project's runtime logs in Vercel** for 5xx, 503, database errors,
Bridge 401/429/5xx, contact follow-up route errors and Home metrics errors,
after the operator's smoke. Anonymous 401 probes are expected, not errors.

## Human signed-in smoke — PENDING (operator)

Not run by me (no Production session was minted or impersonated). To record:

1. Home · 2. Leads (new Follow-up column, also at a narrow width) · 3. the existing
contact's "Next follow-up" region · 4. Transactions (quick-create shows "Close date
(optional)", nothing pre-filled; do not create a deal) · 5. Listings · 6. My Listings ·
7. FortMark Listings · 8. ⌘K with an exact MLS number · 9. Team · 10. Brokerage
settings · 11. one non-Home page: a screen reader's "next heading" finds the section name.

Follow-up dates in the drawer and on Leads are now judged on the Eastern business
day; transaction deadlines, metric windows and the AI follow-up validator still use
UTC days (M-12). Do not read this release as "all dashboard dates are Eastern".

## Optional real follow-up test — SKIPPED

Not run. It writes to the one real contact and is the operator's choice. If chosen:
schedule a **future** day through the UI; expect the follow-up to change, **last
contact unchanged**, **no new activity** (still 6), **one** audit event, and Home /
Leads / drawer to agree. Before: 1 contact, 6 activities, last contact unchanged
since the audit.

## Status and change log

**FOLLOW-UP RELEASE LIVE** (deployment verified; operator smoke outstanding).
Production changes: (1) Production branch fast-forward `f39c0dd` → `a221c21`;
(2) one fresh Vercel Production deployment. Nothing else: no environment variable,
Bridge, Clerk, AI, flag, migration or data change. AI unchanged.
