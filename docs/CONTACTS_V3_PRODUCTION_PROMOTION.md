# Contacts V3 — Production promotion audit

**Type:** audit and plan only. **Nothing was deployed, migrated, configured, merged or written to Production.**
Production access in this phase was read-only SQL (counts and non-identifying shapes) and read-only Vercel and Neon calls.

**Decision: GO FOR CONTACTS V3 PRODUCTION PROMOTION** — subject to the operator steps in §10, in that order.
No P0, no P1. Findings P2/P3 are listed in §13.

---

## 1. The promotable runtime

| | |
|---|---|
| **PROMOTABLE_RUNTIME_REVISION** | **`0f765be`** (the tree every runtime path is identical to) |
| Dev branch head at audit time | the commit that carries this document (documentation, specs, scripts only after `0f765be`) |
| Last full-matrix browser certification | `29cc700` on Preview (runtime-identical to `0f765be`) |
| Production runtime today | `74ff9d4` (`dpl_HHsoeTDXVxGoZFbAg5CZ7vdQ8z6L`, READY, rollback candidate **true**) |
| Ancestry | `74ff9d4` is an ancestor of the dev branch, so Production's branch can be **fast-forwarded** (as for Leads V2) — no merge, no cherry-pick |

**Runtime equivalence.** Paths that can change behaviour: `app/`, `lib/`, `components/`, `middleware.ts`,
`next.config.ts`, `package.json`, `package-lock.json`, `public/`.

- `80c4170` (certified in the implementation report) → `0f765be`: **one runtime file**, `components/leads/lead-drawer.tsx`
  (+12 −2: a failed contact load no longer says "no longer available"; see P2-1). Everything else is docs, e2e specs, scripts.
- `0f765be` → any later dev commit: **no runtime path changes** (re-checked with `git diff --stat 0f765be <head> -- app lib components middleware.ts next.config.ts package.json package-lock.json public` = empty).
- `package.json` differs from `74ff9d4` only in test scripts (`test:contacts-v3`); `package-lock.json` is unchanged. Dependencies are identical.

Contents of the runtime: Transactions hidden-period fix · Leads → Contacts, 307 · personal-book Contacts authorization ·
reassignment removal · notes · birthday · client needs · activity (latest 5) · stage notice · Representation → Transaction ·
linked deals · every fix certified in the implementation phase.

## 2. Production baseline (read-only, 2026-10-01)

| | |
|---|---|
| Revision / health | `74ff9d4`, `ok: true`; sources: transactions `db`, contacts `db`, listings `mls`, home metrics `real-only`, actions `disabled` |
| Deployment | `dpl_HHsoeTDXVxGoZFbAg5CZ7vdQ8z6L`, target production, READY (created 2026-09-30 02:42 UTC), rollback candidate: true |
| Previous READY deployments | `dpl_JE8Sch3v753t68tyEbNJqB7ckJ2L` (`01f7f94`), `dpl_JDgtuMgnyZmb2mN5TtLeBcNzWvPn` (`a221c21`) |
| Migration level | **11 rows (0000–0010)**; none of the V3 tables or columns exist |
| Counts | contacts 1 · activities 15 · opportunities 1 · transactions 2 · transaction parties 2 (0 linked to a contact) · users 1 · profiles 1 · brokerage identities 1 · MLS links 1 · AI prepared actions 0 · audit events 195 |
| Shapes | the 1 contact is at `representation`, has a legacy free-text note and 2 note-kind activities; both transactions are `opportunity` and **undated**; the 1 user is an active `admin`; no orphaned owners; assigned = creator everywhere; 0 contacts outside the brokerage; 0 reassignment events |

Consequence: with one admin user, Contacts looks the same after the release (admin = brokerage-wide). The two undated
opportunity deals are exactly the rows the old hidden reporting period excluded; they will render in Transactions.

Bookkeeping hash note: Production's 0009 row carries the CRLF-variant hash (`f4c19419…`) while the repository has `d7b6f614…`
(known, documented in `CORE_V1_PRODUCTION_PROMOTION_AUDIT.md`). Drizzle compares only the last `created_at`, so it is harmless.

## 3. Backup and restore (required for GO — established)

Capabilities actually available (Neon project `misty-cherry-08153356`, free plan, PostgreSQL 17, AWS us-east-1):

| | |
|---|---|
| Method | A **named Neon branch from the Production branch** immediately before the migration — the same safety point used for the four earlier promotions (`br-shy-rice-av1mq9bf`, `br-lingering-wave-avznii5k`, `br-mute-union-avbf43km`, `br-tiny-unit-avsngi1d`). No SQL dump of client data is made. |
| Name | `pre-contacts-v3-promotion-<YYYYMMDDTHHMMZ>-from-production-fortmark-professional-profiles` |
| Source | `br-bitter-cake-av7pmzth` at its current head; no compute needed. Record branch id, parent LSN, timestamp. |
| Retention | The named branch persists until deleted. Point-in-time restore covers only the project's **6-hour** history window (`history_retention_seconds` 21600) — so the named branch, not PITR, is the durable restore point. |
| Capacity | 8 branches exist (1 archived) of a 10-branch limit: room for the safety branch (9) and one optional rehearsal branch (10). Do not delete the older safety branches to make room without an explicit decision. |
| Restore | Neon branch restore of Production from the safety branch (or PITR inside 6 h). Conceptually minutes for a database this size (≈32 MB). **It discards every write after the restore point**, so it is a human decision only and nothing restores automatically. |
| When needed | Probably never: the migrations are additive and the old runtime is proven compatible with the new schema (§8), so the first response to any problem is **application rollback**, not restore. |

## 4. Migration 0011 — `contact_notes` (sha256 `b15ded1f3a4e8b87…`)

New table only. No `ALTER`/`DROP`/`UPDATE` of existing objects; no backfill.

- Columns: `id uuid pk default gen_random_uuid()`, `contact_id uuid not null`, `author_user_id uuid`, `body text`, `created_at timestamptz default now() not null`, `deleted_at`, `deleted_by_user_id`.
- FKs: `contact_id → contacts.id ON DELETE CASCADE`; `author_user_id`, `deleted_by_user_id → dashboard_users.id ON DELETE SET NULL`.
- Index: `contact_notes_contact_created_idx (contact_id, created_at DESC)`.
- **CHECK `contact_notes_body_check`**: a live note has a body of 1–10,000 characters; a deleted note has `deleted_at` set **and a NULL body**. The text cannot survive a delete at the database level.
- The legacy `contacts.notes` block is **not copied** (§7).

## 5. Migration 0012 — birthday (sha256 `9b8b06204a687fa7…`)

- Two **nullable** `smallint` columns on `contacts`: `birthday_month`, `birthday_day`. No year. No default, no backfill.
- **CHECK `contacts_birthday_check`**: both null, or both set with month 1–12 and a day valid for that month (**Feb 29 allowed**, Apr/Jun/Sep/Nov ≤ 30, others ≤ 31). A month without a day, or a day without a month, is refused (this was a real defect caught by the migration test and fixed before approval).
- Existing rows have both null, so they satisfy it. Verified on a populated 0010 database (§6).

## 6. Migration 0013 — client needs (sha256 `0eaa72c92da161b0…`)

- Three enum types (`contact_need_kind`, `_status`, `_financing`) and one table `contact_needs`; no existing row is rewritten; **no Opportunity migration** (`contact_opportunities` is untouched) and no Bridge field names anywhere.
- Money: `bigint` **cents** (`price_min_cents`, `price_max_cents`); baths `numeric(3,1)` in half steps; arrays (`property_types`, `areas`, `must_haves`, `avoid`) bounded by cardinality (8/12/20/20); text fields bounded (200 / 2,000).
- FKs: `contact_id → contacts ON DELETE CASCADE`; `created_by`/`updated_by → dashboard_users ON DELETE SET NULL`. Index `(contact_id, status)`.
- CHECKs: `contact_needs_price_check`, `_size_check`, `_bounds_check`. Per-element lengths of the array values are enforced by the service (`lib/contacts/needs.ts`), not by the database (P3-3).

## 7. Migration safety — evidence

`npm run test:migrate` (real PostgreSQL, the unmodified Neon driver and the repository's own `runMigrations`): **82/82**, including a new
**Production-shaped** section:

- a database built to **0010** (Production's level, 11 bookkeeping rows) holds representative legacy rows (2 users, 2 contacts — one at Representation with a legacy note and a tag —, 3 activities including a note, an opportunity, 2 undated deals, parties with no contact link, audit rows);
- **a failing migration appended to 0011–0013 rolls the whole batch back**: no V3 table, column or type remains, bookkeeping stays at 11, every legacy row is byte-identical (md5 of each table);
- the real **0010 → 0013** applies as one batch of three (bookkeeping 11 → 14); every legacy row is **byte-identical** afterwards; all five new constraints exist and are validated; no note, need or birthday appears (no backfill); the legacy note stays on the contact; existing deals keep a NULL contact link; the Representation contact stays at Representation;
- an insert/update that omits the new columns (what the old runtime does) is accepted;
- re-running applies nothing; the advisory lock is released; `CREATE INDEX CONCURRENTLY` and `ALTER TYPE … ADD VALUE` are refused up front, and every committed migration is transaction-safe.

Engine note: local tests ran on PostgreSQL 16; Neon runs **17**. The SQL is plain DDL. Preview's Neon branch (PG 17) has already applied the same three files through the same runner; only populated-data behaviour was not exercised on 17 (P3-4; the optional rehearsal in §10 closes it).

**Locks / downtime (from the exact SQL).** `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX` on new empty objects; `ADD COLUMN` nullable with no default is metadata-only; `ADD CONSTRAINT … CHECK` on `contacts` scans the table under an `ACCESS EXCLUSIVE` lock (**1 row** in Production); the FK additions take a brief `SHARE ROW EXCLUSIVE` on `contacts` and `dashboard_users`. All in one transaction. Expected: **sub-second, imperceptible** — but not promised as zero; a writer on `contacts` at that instant would wait for it.

## 8. Old runtime (`74ff9d4`) against schema 0013 — PASS

Reproducible harness (`scripts/audit/`; not part of `npm test`): a throwaway PostgreSQL migrated to **0013**, seeded with Production-shaped legacy rows, answering the Neon HTTP SQL protocol; the **real services of a `74ff9d4` worktree, with its own drizzle schema,** run against it.

**20/20 passed**: contacts page (admin and agent scope), snapshot, contact with legacy note, activities, timeline, create / edit / change stage / log touch / follow-up / **reassign** (a route that exists only in the old runtime), transactions list / legacy deal / create / change stage, global search, Home metrics; the V3 tables and columns stay empty; audit rows are written (`event_type` is text, not an enum).
**Negative control** (`COMPAT_BREAK=1`, drops a column the old code reads): **8/19** — the harness does fail when it should.

Why it holds: the migrations add only new tables, new types and two nullable columns; Drizzle in the old runtime names its columns explicitly, so it never sees the new ones; no existing enum gains a value; the new CHECKs accept an insert that leaves the new columns NULL.

**The reverse is not true:** the new runtime selects `birthday_month`/`birthday_day` on every contact read (and Home metrics read contacts), so deploying the new runtime **before** the migration would break Contacts, Home and linked-deal reads. **Migrate first, deploy second** (§10).

## 9. Production data compatibility — PASS (30/30)

The same harness with the new runtime (this repository) on the Production-shaped data:

- the pre-existing **Representation** contact renders with its legacy note and no birthday; it is **not** forced through the stage notice (editing it needs no acknowledgement) and nothing moves its stage;
- the legacy note is **not duplicated** into `contact_notes` (`listNotes` returns none) and is shown once, as "Legacy note"; the existing note-kind activities remain timeline events; the timeline renders;
- deals with a **NULL `contact_id`** list and open; a deal without a contact still creates (free-text client); a deal from a Representation contact makes it the primary client party through `transaction_parties.contact_id` (no join table) and the contact lists the linked deal; a contact below Representation is refused (`invalid_contact`);
- admin sees the whole brokerage, an agent sees their own book; ownership is untouched (assigned = creator); no automatic stage change, no automatic linking, no backfill;
- add / delete note (row stays, body NULL), create need, set / clear birthday work; **no audit row contains** the note text, any need value, or a birthday value; Home metrics compute.

## 10. Operator deployment order (do not execute until authorized)

Migrate **before** deploying: the old runtime tolerates 0013; the new runtime does not tolerate 0010.

1. **Safety point.** Create the named Neon branch (§3). Record id, LSN, timestamp.
2. *(Recommended, optional)* **Rehearsal.** Branch the safety branch (a copy on PG 17 with the real data shape), run steps 3–4 against it, delete it afterwards. Uses the last free branch slot.
3. **Preflight** (read-only, same driver; the connection string is typed at a prompt, never written to a file or history): host fingerprint must equal the Production fingerprint recorded in `CORE_V1_PRODUCTION_PROMOTION_AUDIT.md` §6; expect **11** bookkeeping rows, `to_regclass('public.contact_notes')` null, no `birthday_*` columns, and the §2 counts.
4. **Migrate** from a checkout of the promotable runtime: `npm run db:migrate` (unpooled URL). Expect `migrations applied atomically (bookkeeping rows 11 -> 14, 3 new)`; a non-zero exit means the transaction rolled back — re-run the preflight (still 11), stop and investigate; never hand-apply SQL.
5. **Verify** (read-only): 14 rows; last three hashes equal the repository files' sha256 (`b15ded1f…`, `9b8b0620…`, `0eaa72c9…`); `contact_notes`, `contact_needs` exist and are empty; 5 new constraints validated; counts of §2 unchanged; **the current Production site still answers normally** (old runtime on the new schema).
6. **Deploy:** fast-forward the Production branch `claude/fortmark-dashboard-build-v39u96` from `74ff9d4` to the dev head by a plain push (no force). Vercel builds it; the Production build prints `migrations skipped` by design (Preview-only guard).
7. **Health:** `/dashboard/api/health` shows the new revision, `ok: true`, sources unchanged.
8. **Smoke (§11)**, then **logs (§12)**.

## 11. Human smoke plan (no automatic mutation)

Sign in as the Production admin:
1. Home loads; the Contacts cards/links go to `/dashboard/contacts`.
2. `/dashboard/leads?stage=representation` → 307 → `/dashboard/contacts?stage=representation` (query kept; no loop); `?open=<id>` opens the drawer; browser Back works.
3. Contacts: snapshot cards and views (All contacts · Representation · Active clients · Due today · Overdue · No touch 14+); the existing contact appears; its stage is unchanged.
4. Open it: header → Client needs → Notes (composer visible; the **Legacy note** appears once) → Activity (latest 5, "Show all") → Representation → Transactions.
5. Birthday shows "Not set". Client needs shows "No client needs added."
6. Owner line and Owner filter visible (admin only); **no reassignment** anywhere.
7. Representation → "Create transaction" is offered at Representation only; **open the dialog and cancel** (do not create).
8. ⌘K search finds the contact by name; nothing in results shows notes, needs or birthdays.
9. Transactions: the **two existing deals are visible** (previously hidden by the reporting period); Home period changes do not change the list; New → Transaction shows the Representation contact selector (own scope) and free-text fallback; cancel.
10. Listings, Team, Brokerage load as before.
11. Mobile (phone width): Contacts list, drawer, needs form, notes composer fit without sideways scrolling.

**Optional, operator-controlled, only if genuinely wanted** (no ceremonial data): add a real note and check its timestamp; set a birthday only if you want it stored; add a real client need if useful. **Do not** change a stage just to test, and **do not** create a fake transaction.

## 12. Log plan (after deployment)

Vercel project `fortmark-dashboard` (`prj_5KVjhWtseC2mnPMkMU35D9F40wQV`, team `team_lrHGYzrhpDXRjeAepo6ezt7Q`), environment production: 5xx and 503; messages containing `relation`, `column`, `birthday`, `contact_notes`, `contact_needs`; routes `/api/contacts/*`, `/api/transactions`, `/api/metrics`, `/api/search`; Bridge/listings errors; Home metrics. Baseline now: **no 5xx in Production in the last 24 h and none in Preview in the last 3 h** (so the 502s seen in browser runs were edge-level, not application errors). If logs are unavailable after deploy: **NOT VERIFIED**.

## 13. Findings

| # | Sev | Finding | Disposition |
|---|---|---|---|
| P2-1 | P2 | The contact drawer reported **any** failed load (a dropped request, a 5xx) as "This contact is no longer available." — present in Production today. Found when a coordinator run showed that text for the user's own contact. | **Fixed in `0f765be`**: only a real 404 says that; a failed load says "We could not load this contact" with **Try again**. Browser-certified for all five roles (§14). |
| P3-1 | P3 | The stage notice is a UI step. The stage API and the AI-assisted action path do not require the acknowledgement; the audit records `engagementAcknowledged: false` for them. This matches the approved design (no document store, no hard block). AI actions are `disabled` in Production. | Accept now. Revisit before enabling AI actions, and with M4. |
| P3-2 | P3 | Notice copy: "An executed engagement should be attached to the contact record." is an instruction, and the next line says FortMark does not yet store or check documents; but "attached" could be read as an in-app attachment. | Not changed (certified copy). Operator may prefer "should be on file". |
| P3-3 | P3 | Per-element length of need areas / must-haves is enforced in the service, not by a database CHECK. | Accept. |
| P3-4 | P3 | Local migration rehearsal used PostgreSQL 16; Neon is 17 (Preview already applied the files on 17). | Optional rehearsal in §10 step 2. |
| P3-5 | P3 | Production 0009 bookkeeping hash is the CRLF variant. | Known, harmless. |
| P3-6 | P3 | `?open=<contact id>` keeps an opaque UUID in the URL (existing Leads V2 behaviour). No names, notes or needs. | Accept. |

**P0: none. P1: none.**

## 14. Browser certification (real Clerk session, Preview, synthetic fixtures, removed afterwards)

Spec: `e2e/contacts-v3-ui.spec.ts`. Platform noise (aborted reads, a 502, one dropped chunk, a New menu/New contact click that raced hydration) is counted and printed; **no product exception in any run**.

| Role | Result | Revision |
|---|---|---|
| admin | **18 passed**, 2 skipped (member-only / broker-only steps) — one uninterrupted run | `29cc700` (= `0f765be` runtime) |
| agent | **18 passed**, 2 skipped | `29cc700` |
| member | **12 passed**, 8 skipped (write paths a read-only role cannot take) | `29cc700` |
| **broker** | **18 passed**, 1 skipped (member-only); plus the failed-load test alone on `29cc700` | `0f765be` / `29cc700` |
| **transaction coordinator** | **18 passed**, 1 skipped; plus the failed-load test alone on `29cc700` | `0f765be` / `29cc700` |

What the broker and coordinator runs prove (the domain boundary): **Contacts are an own-only book** — the colleague's Representation contact, the colleague's lead and a contact in another brokerage are absent from the list and **cannot be opened by URL** ("no longer available"); no Owner filter; no reassignment; own contact drawer in the required order with notes, birthday, needs, follow-up, touch, stage notice and activity; **Transactions are brokerage-wide** — the colleague's deal and the undated opportunity deal are visible and the hidden Home period does not hide them; and **the New Transaction contact selector offers only the caller's own Representation contacts** — the colleague's Representation contact is not offered and searching for it by name finds nothing. A first coordinator run failed once at the failed-load conflation (P2-1); it was fixed and the role passed on rerun.

API certification (all five roles + a foreign-brokerage control) was completed in the implementation phase on `80c4170`; the API surface is unchanged since.

## 15. Security, privacy, scope

- **Notes:** authenticated, authorized through the contact, `Cache-Control: private, no-store` on every new route (verified route by route); plain text; delete NULLs the body; no audit, search, ⌘K, URL, log or AI path carries a body (verified in code and by the Production-shaped run).
- **Birthday:** month/day only; no year; no age arithmetic; not searchable; not in audit values or URLs.
- **Needs:** private and `no-store`; authorized through the contact; the audit carries field names only; `getContactNeeds(ctx, contactId)` is the authorization-aware boundary and is **not wired to any AI tool** (`lib/ai` and `app/api/chat` have no change since `74ff9d4`); no Bridge coupling; Opportunities untouched.
- **AI, MLS, listings:** unchanged — no file under `lib/ai`, `app/api/chat`, `lib/mls`, `app/api/listings` differs from `74ff9d4`.
- **Authorization:** by `role`, never by email; out of scope is 404; read-only is 403. Broker/coordinator Contacts are own-only; their Transactions stay brokerage-wide.
- **Reassignment removed:** no endpoint (the route file is deleted), no UI, no create-time owner override; historical `assigned_agent_user_id` and the historical timeline label remain.
- **Client bundle secret scan** (106 files, clean worktree build): no Bridge/DB/OpenAI/Anthropic/Clerk-secret/Blob-write values; the two pattern hits are a Tailwind class-name substring and Clerk's SDK reading `process.env.CLERK_SECRET_KEY` (a name, inlined as undefined). None of the checked secret names (database URLs, Bridge, OpenAI, Anthropic, Blob tokens, the planned engagement token) appears in client chunks.

## 16. Environment — UNCHANGED

The set of `process.env.*` names read by `app`, `lib`, `components`, `middleware.ts`, `next.config.ts` is **identical** at `74ff9d4` and the promotable runtime. **No new environment variable is required.** The runtime references **no** `ENGAGEMENT_BLOB_READ_WRITE_TOKEN` and no `contact_engagements` object; it starts and runs without it.

## 17. M4 — ENGAGEMENT ATTACHMENT DEFERRED

Not part of this release. The release has the warning/acknowledgement only: no engagement document store, no attachment UI, no hard-block of regular users, no public Blob fallback (the public profile-photo store is never used for engagement documents). M4 stays its own gate, after a private store is provisioned for the right environments (operator step in `CONTACTS_V3.md`).

## 18. Build gate (clean worktree of `29cc700`, runtime-identical to `0f765be`)

`npm test` — 20 suites, exit 0 (Contacts V3 325, Leads V2 267, follow-up 157, transactions 171, contacts 129, search 64, shell 42, MLS 225, MLS identity 112, AI/tools/providers/actions 92·148·113·247, metrics 102, mock-leak 61, atomicity 49, team 30, brokerage 98, profile 1,141, dashboard 90) · `npm run test:migrate` **82/82** · `npx tsc --noEmit` clean · `npm run build` compiled; Production-shape build prints migrations skipped · secret scan clean.

## 19. Rollback

| Layer | Plan |
|---|---|
| **Application (first response)** | Vercel instant rollback to `dpl_HHsoeTDXVxGoZFbAg5CZ7vdQ8z6L` (`74ff9d4`; `isRollbackCandidate: true`), or revert the Production branch. **Valid with schema 0013 left in place** (§8). Anything written under V3 (notes, needs, birthdays, linked deals) stays in the database, invisible to the old runtime, and is not lost. |
| **Database** | **Not required** for a runtime defect — the migrations are additive. Restore from the safety branch only for data corruption, and only by human decision (it discards later writes). |

Application-only rollback: **YES**. Database restore required: **NO** (only for data corruption).

## 20. GO criteria

Broker browser PASS · coordinator browser PASS · backup/restore path established · 0011–0013 safe · legacy Production data compatible · old runtime works on schema 0013 · no environment change · M4 absent/deferred · authorization correct · notes, birthday, needs private · Transactions loading fixed · Representation selector scope correct · build and tests green · no P0 · no P1.

**GO.** Stop: wait for explicit authorization to migrate Production and deploy. Nothing was migrated, merged or deployed in this phase.

---

# PRODUCTION EXECUTION

**Authorised:** 2026-10-02. Certified runtime **`0f765be`**. Order: safety branch → Neon 17 rehearsal → Production migration → verify → fast-forward → deploy → health → smoke → logs.

## 1. Frozen state (15:37Z) — matches the audit, no drift

- Production `74ff9d4`, `dpl_HHsoeTDXVxGoZFbAg5CZ7vdQ8z6L` READY, `isRollbackCandidate: true`; default branch at `74ff9d4`.
- Health: transactions `db`, contacts `db`, listings `mls`, homeMetrics `real-only`, assistant `openai`/`no_credential`, actions `disabled`.
- DB `br-bitter-cake-av7pmzth`: **11 migrations** (last `created_at` 1790138386822, hash `43217604…`); contacts 1 (Representation, 1 legacy note), activities 15, opportunities 1, transactions 2, parties 2 (0 linked), users 1 (`admin:active`), profiles 1, brokerage 1, MLS links 1, audit 195; `contact_notes`/`contact_needs` absent; no birthday columns.
- Source: `0f765be` is a clean fast-forward of `74ff9d4`; dev head `02d7a73` is runtime-identical to it (empty diff on every runtime path). `0f765be` is the revision to deploy, not the dev head.

## 2. Production safety branch — CREATED, RETAINED

- **`br-patient-poetry-av0t6hrc`** — `contacts-v3-prod-safety-20261002T1538Z-from-production-fortmark-professional-profiles`.
- Parent `br-bitter-cake-av7pmzth` at LSN **`0/2224F30`** (parent timestamp 2026-10-02T15:37:12Z); no compute; `ready`; taken at migration level 11.
- Retained until the release has been stable and the operator approves deletion. Restore only for real data corruption, only by human decision (it discards later writes).

## 3. Neon 17 rehearsal — RUN, PASS

- Temporary branch `br-holy-fire-av8ft4sk`, **branched from the safety branch** (same LSN). Its `neondb_owner` password was reset **on that branch only** (Neon resets are branch-scoped), so the runner could connect without Production's credential ever entering this session; that throwaway credential died with the branch.
- Canonical runner from a clean `0f765be` checkout: `npm run db:migrate` → **`migrations applied atomically (bookkeeping rows 11 -> 14, 3 new)`**, every post-check present, exit 0.
- Verified on PG 17 with the real data shape: the 3 new bookkeeping rows equal the repository files (`b15ded1f…`, `9b8b0620…`, `0eaa72c9…`, journal times `1790743155894/…164664/…179789`); the first 11 rows unchanged; 5 new constraints validated; 3 enum types; 2 indexes; `contact_engagements` absent; **every legacy table byte-identical** (md5 over all rows before vs after: contacts [excluding the two new columns], activities, opportunities, transactions, parties, users, profiles, brokerage, audit); 0 notes, 0 needs, 0 birthdays (no backfill); contact still Representation; legacy note present; 0 linked parties.
- Real services of each runtime against the migrated copy:
  - **`74ff9d4`: PASS** — contacts page, snapshot, the Representation contact with its legacy note, 15 activities, timeline, both deals listed and opened (NULL contact link), global search by name and by address, Home metrics, plus a touch and an edit (writes on the copy only).
  - **`0f765be`: PASS** — the same reads, plus: legacy note not duplicated, needs empty, no linked deals, the Representation selector offers the contact, note add → delete leaves a body-less tombstone, a need, Feb 29 set/clear; no audit row and no search result carries a note body or need value; stage unchanged.
  - Two first-pass misses were harness errors, not product defects: an activity count read after the old-runtime run had added a touch (16 = 15 + 1), and a search call with the wrong signature. Re-checked correctly; both pass.
- Audit-harness correction: the committed `scripts/audit/compat_old.mjs` search check passed only because the response echoes the query. It now requires a hit carrying the contact's id; re-run 20/20 (old) and 31/31 (new, now including search).
- Rehearsal branch **deleted**; the slot is recovered.

## 4. Final preflight (15:4xZ)

Production still `74ff9d4`, 11 migrations, counts unchanged; safety branch ready; rehearsal passed; runner clean (`assertTransactionSafe` on all 14); no unexpected deployment.

## 5. Production migration — OPERATOR STEP (pending)

This session cannot run the canonical runner against Production without the Production connection string passing through the transcript (Vercel variables are write-only; Neon's tool returns the URL as text; a password reset on Production would rotate the live app's credential). The one-transaction SQL reproduction used for 0010 is excluded by this release's instruction not to touch bookkeeping by hand. As for 0009, the operator runs the canonical command on their own machine:

```bash
git fetch origin && git checkout --detach 0f765be && npm ci
unset DATABASE_URL DATABASE_URL_UNPOOLED
# Neon console › misty-cherry-08153356 › branch production/fortmark-professional-profiles (br-bitter-cake-av7pmzth)
#   › Connect › Connection pooling OFF › copy the URL, then paste at the silent prompt:
read -rs DATABASE_URL_UNPOOLED && export DATABASE_URL_UNPOOLED

# 1. Target proof — MUST print 23deffc7e4e5, else STOP.
node -e 'const h=new URL(process.env.DATABASE_URL_UNPOOLED).hostname.replace("-pooler","");console.log(require("crypto").createHash("sha256").update(h).digest("hex").slice(0,12))'

# 2. Preflight (read-only). Expect { migrations: 11 } and { notes_absent: true }.
node --input-type=module -e '
import { Client } from "@neondatabase/serverless";
const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await c.connect();
console.log((await c.query("select count(*)::int as migrations from drizzle.__drizzle_migrations")).rows[0]);
console.log((await c.query("select to_regclass(\x27public.contact_notes\x27) is null as notes_absent")).rows[0]);
await c.end();'

# 3. Canonical migration. Expect "[migrate] migrations applied atomically (bookkeeping rows 11 -> 14, 3 new)", exit 0.
npm run db:migrate

unset DATABASE_URL_UNPOOLED
```

A non-zero exit means the transaction rolled back: re-run step 2 (it must still show 11), stop, report. Never hand-apply SQL. **Do not deploy until §6 passes.**
