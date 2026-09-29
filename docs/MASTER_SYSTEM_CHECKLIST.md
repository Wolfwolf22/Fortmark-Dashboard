# FortMark — Master System Acceptance Certification

The authoritative product acceptance record. It answers one question: **can the
operator rely on this dashboard for normal brokerage work — without AI?**

Result: **MASTER CHECKLIST PASS WITH ISSUES.** No P0, no P1. One P2 was found
and fixed. What could not be verified from here is listed plainly in §9 rather
than counted as a pass.

No secrets and no customer information are in this document.

## 1. Baseline (frozen before testing)

| | Preview | Production |
|---|---|---|
| Revision | `32bcac6` at start; `a221c21` after the one fix | `f39c0dd` (unchanged throughout) |
| Health | 200 | 200 |
| Listings | `not_configured` (no MLS credential; it lives in Production) | `mls` |
| Contacts / Transactions | `db` / `db` | `db` / `db` |
| Home metrics | `real-only` | `real-only` |
| AI | provider available; **actions enabled** | no credential; **actions disabled** |
| Migrations applied | 11 | 11 (repo has 11 files: no drift either side) |
| Records | 0 contacts, 0 activities, 0 transactions, 0 deadlines, 0 prepared actions; 1 user, 1 profile, 1 brokerage identity, 0 MLS links | 1 contact, 6 activities, 0 transactions, 0 prepared actions; 1 user, 1 profile, 1 brokerage identity, 1 MLS link (linked) |

Repository: branch `claude/dashboard-status-yir55p`. Production branch
`claude/fortmark-dashboard-build-v39u96` was not touched.

## 2. Method

- **Preview** was tested exhaustively with synthetic records, five role
  identities (the certification user's role switched in the Preview database
  between runs), a second agent, and records in a second brokerage.
- **Production** was read-only: health, anonymous refusal behaviour, cache
  headers, runtime logs, and record counts. No synthetic records, no test user,
  no role change, no session minted.
- Every refusal is paired with the same request succeeding for a caller who may
  make it, and every "unchanged" assertion with a step that changes the same
  field, so a green result cannot come from a harness that never writes.
- Every browser step is bounded (30 s per action, 60 s per navigation, 3 min
  per test, 20 min per run) and every run is wrapped in an outer timeout.
  Platform error pages are reloaded only when recognised, and counted (§8).

## 3. Status vocabulary

PASS · PASS WITH NOTE · FAIL · NOT CONFIGURED · NOT IMPLEMENTED · DEFERRED.
"PASS WITH NOTE" is used wherever the evidence is real but indirect.

## 4. Authorization matrix (Preview, actual policy)

Policy is the code's, not this document's: privileged = admin, broker,
transaction coordinator (see and change every record in the brokerage); agents
own their records; members read but never write; only admin and broker edit the
brokerage. 14 checks per role, all passing.

| | admin | broker | coordinator | agent | member |
|---|---|---|---|---|---|
| Sees colleague's contacts / deals | yes | yes | yes | **404** | **404** |
| Sees another brokerage's | 404 | 404 | 404 | 404 | 404 |
| Own contact: stage / follow-up / touch / create | 200/200/201/201 | same | same | same | **403** all |
| Colleague's contact: change stage | 200 | 200 | 200 | 404 | 404 |
| Deal: change stage / create | 200 / 201 | same | same | same | **403** |
| Home metrics scope | brokerage | brokerage | brokerage | own | own |
| Team roster | full, with status | full | full | active only | active only |
| Brokerage: `canEdit` / write | true / allowed | true / allowed | **false / 403** | false / 403 | false / 403 |
| Crafted profile body (`role`, `status`, email, Clerk id) | stripped, nothing changed | same | same | same | same |

- Out-of-scope records answer **byte-identically** to a nonexistent id.
- The metric count equals what the role can list (computed, not assumed).
- Brokerage editing: admin and broker edit through the UI (10 checks each,
  including 390/430/1440 fit); agent, member and coordinator get the read view
  (7 checks each). The audit event records `brokerageKey` and `changedFields`
  only. A seeded foreign brokerage record was never returned to anyone.
- **Foreign brokerage:** the system has one brokerage. `resolveActor` gives every
  caller the same brokerage key; there is no user-to-brokerage membership. The
  isolation certified is therefore *record-level* (records under another key),
  which holds on contacts, deals, search, metrics, brokerage identity and
  prepared actions. A user of another brokerage cannot exist yet (register M-08).

## 5. Workday results

| Workday | Result | Steps |
|---|---|---|
| **Agent, no AI** | **YES** | Home (real zero desk) → MLS/listing pages (truthful) → create contact (UI) → schedule follow-up → **last contact unchanged, 0 activities** → log touch → **last contact moved, follow-up kept** → ⌘K finds the person → deal with blank close date → **0 Closing deadlines** → deal with close date → **exactly 1** → stage moved by hand → Home shows the same 2 active deals as the API → ⌘K finds the deal → Profile and Team |
| **Broker, no AI** | **YES** | Home brokerage-scoped → FortMark Listings (truthful) → Team with status → Brokerage settings with edit → colleague's contact: follow-up scheduled with no touch → colleague's deal moved → search across the brokerage (never the other brokerage) → metrics equal the broker's list |

**Limit:** Preview has no MLS credential, so the MLS legs assert the *truthful
state* and that nothing is fabricated. Live MLS is certified by the offline suite
(225 checks) and by the operator's own Production use (§9), not by this run.

## 6. Test evidence

| Layer | Result |
|---|---|
| `npm test` (18 suites) | 3,026 checks, all pass |
| Migration runner | 23/23 (atomic, locked, bookkeeping atomic, repeat-safe, rollback-safe, unsafe statements refused) |
| Build / typecheck | clean |
| Atomicity suite (new) | 48 checks; 5 deliberate regressions each caught |
| Follow-up suite | 155 checks; 7 deliberate regressions each caught |
| Full-system (Preview) | 29/29 |
| Role matrix (Preview) | 5 roles × 14 |
| Brokerage phases | editor ×2, read-only ×3 |
| Follow-up phases (Preview) | member, agent, broker, incl. a browser clock at 11:30 PM Eastern |
| Rendered AI confirmation | 14 (typed "yes" changes nothing; Confirm and Decline are real clicks) |
| Zero-data sweep / shell / API smoke / palette focus | 8 / pass / pass / pass |
| Request sanity | 2–5 API calls per page, no duplicates or per-row requests, with 12 contacts and 8 deals present |

Behavioural stage-writer results (offline, transactional stand-in): every
required write forced to fail leaves the stage unchanged with no event and no
audit; all 121 transaction stage pairs agree with the rule; a refused move writes
nothing; terminal stages are irreversible; contact stage changes commit as one
batch (update, one activity, one audit).

## 7. Subsystem inventory

| Subsystem | State | Backing | Preview | Production | Certified? | Notes |
|---|---|---|---|---|---|---|
| Authentication | Live | Clerk + allowlist | PASS | PASS WITH NOTE | Preview yes | Production sign-in is the operator's path (§9); anonymous refusal (401, no-store) and redirect verified |
| Authorization | Live | roles + ownership | PASS | PASS WITH NOTE | yes (Preview) | §4 |
| Professional profiles | Live | DB | PASS | PASS WITH NOTE | yes | licence validation offline (1,141-check suite) |
| Professional licence | Live | DB, never "verified" | PASS | PASS WITH NOTE | yes | no DBPR claim anywhere |
| Profile images | Live | Blob | PASS WITH NOTE | PASS WITH NOTE | offline | not exercised live this run |
| Team | Live | DB | PASS | PASS WITH NOTE | yes | privileged fields gated; no raw ids |
| Brokerage identity | Live | DB + MLS office | PASS | PASS WITH NOTE | yes | agent licence never shown as the brokerage's |
| MLS member identity | Live | Bridge | NOT CONFIGURED | PASS WITH NOTE | offline | 1 linked member in Production |
| General MLS | Live | Bridge | NOT CONFIGURED | PASS WITH NOTE | offline + operator | §9 |
| My Listings | Live | Bridge | NOT CONFIGURED | PASS WITH NOTE | offline | listing vs co-listing agent asserted offline |
| FortMark Listings | Live | Bridge, office id | NOT CONFIGURED | PASS WITH NOTE | offline | id match, never name |
| Listing detail | Live | Bridge | NOT CONFIGURED | PASS WITH NOTE | offline | withheld address replaced; display exclusion at the boundary |
| Listing media | Live | embedded media | NOT CONFIGURED | PASS WITH NOTE | offline | no per-card requests (asserted) |
| Comparables | Live | Bridge | NOT CONFIGURED | PASS WITH NOTE | offline | |
| Contacts | Live | DB | PASS | PASS | yes | |
| Contact follow-ups | Live (Preview only) | DB | PASS | not deployed | yes | §5 |
| Contact activities | Live | DB | PASS | PASS | yes | |
| Opportunities | Domain only | DB | NOT IMPLEMENTED (UI) | same | n/a | designed, not built |
| Transactions | Live | DB | PASS | PASS | yes | |
| Transaction deadlines | Created at creation only | DB | DEFERRED | DEFERRED | n/a | cannot add / edit / complete afterwards |
| Home metrics | Live | DB, real-only | PASS | PASS | yes | unavailable ≠ zero |
| Unified search | Live | DB + MLS | PASS | PASS WITH NOTE | yes | wildcards escaped (see M-02) |
| Calendar | — | none | NOT CONFIGURED | NOT CONFIGURED | truthful | says so; no invented events |
| Documents | — | none | NOT CONFIGURED | NOT CONFIGURED | truthful | |
| Messages | — | none | NOT CONFIGURED | NOT CONFIGURED | truthful | |
| Reports | — | none | NOT CONFIGURED | NOT CONFIGURED | truthful | "states nothing rather than estimating" |
| Notifications | — | none | NOT CONFIGURED | NOT CONFIGURED | PASS WITH NOTE | no invented count (zero-data sweep) |
| Settings | Live | DB | PASS | PASS WITH NOTE | yes | Profile, Team, Brokerage real; Integrations not exercised individually |
| AI | Secondary | OpenAI | PASS | disabled | regression only | |
| AI actions | Controlled | prepared + confirm | PASS | disabled | regression only | typed "yes" never executes |
| Audit | Live | DB | PASS | PASS WITH NOTE | yes | real actor, safe metadata, no PII, no duplicates |
| Migration infrastructure | Live | runner | PASS | PASS | yes | 23/23; 11 applied both sides |

## 8. Logs, performance and platform stability

- **Preview runtime logs** (run window, ~6,700 requests): the 503s are the
  deliberate "MLS not configured" answers; 404/400/403/409 are the negative tests;
  **7 × 500**, all one error: *"The router state header was sent but could not be
  parsed"* — 1 on the dashboard, 6 on the portal. Next.js answers an unparsable
  `next-router-state-tree` header with 500 rather than 4xx (confirmed with a
  truncated header). What produces the bad header here is **not proven**; it is
  environment-correlated (register M-06).
- **Production** since it went live: 22 × 401 (anonymous probes), 11 × 200,
  2 × 307, **no 5xx**, no Bridge 401/429/5xx. Traffic is very thin, so this is
  clean but weak evidence.
- **Platform reloads** (recognised platform pages only, counted): 2 counted in
  this phase (1 page, 1 AI composer). Also 2 platform failures that failed a run
  and were re-run (1 Clerk initialisation, 1 "Application error" page). No
  product failure was hidden by a reload.
- **Bounded execution:** an earlier stalled harness step led to explicit action,
  navigation, hook and global timeouts in `playwright.config.ts`; nothing in this
  certification may run unbounded.

## 9. What could not be verified from here (operator checklist)

I did not sign in to Production and did not mint a session; the MLS credential
lives only in Production. So these are **PASS WITH NOTE**, not PASS:

1. Sign in → Home loads → no redirect loop → refresh keeps the session → sign out.
2. Home **FortMark active** count equals **Listings → FortMark listings** total.
3. The featured listing belongs to office FTMK01.
4. Listings → Fort Lauderdale, Active: real rows, photos, prices, attribution.
5. My Listings shows only the operator's, labelled listing vs co-listing agent.
6. One listing detail and one comparables query load.

Indirect evidence already in hand: the operator's own Production requests
(listings, detail, comparables, featured) returned 200 with no Bridge errors;
the offline MLS suite (225 checks) covers filters, type mappings, withheld
addresses, display exclusion, embedded media, token-in-header-only and office-id
matching.

## 10. Issue register

No P0. No P1.

| ID | Sev | Domain | Description | Reproduction | Impact | Blocks Production? | Recommendation |
|---|---|---|---|---|---|---|---|
| M-01 | **P2 — fixed** | Accessibility | Every section except Home shipped with **no `h1`** (the redesign removed the page-title heading). Present in Production `f39c0dd`. | Full-system sweep: 9 routes with 0 `h1` | Screen readers have no page heading | No | **Fixed** in `a221c21`: a visually hidden `h1` from the navigation table; Home and onboarding exempt; 10 routes verified; 8 new checks |
| M-02 | P3 | Contacts | The list filter `q` **strips** `%` and `_`, so `q=%` becomes an empty pattern and matches every row the caller may see | `GET /api/contacts?q=%25` | Authorization intact (never widens scope); wrong semantics. The unified search escapes correctly | No | Escape instead of strip |
| M-03 | P3 | Team | The roster shows each person's account email when no alternative is set, to every role | agent `GET /api/team` | Documented, disclosed choice | No | Revisit when there is an external audience |
| M-04 | P3 | API | A bad `stage=` filter value is ignored (200) rather than refused | `GET /api/contacts?stage=bogus` | Harmless | No | 400 |
| M-05 | P3 | API | `GET` on the POST-only search route returns 405 with a public cache header | `GET /api/search` | No data | No | private, no-store |
| M-06 | P3 (platform?) | Platform | 7 × 500 "router state header … could not be parsed" (dashboard and portal) | Preview logs; reproducible with a truncated header | Possible cause of the occasional "Application error" page; origin unproven | No | Watch Production traffic; treat as infrastructure until shown otherwise |
| M-07 | P3 | Performance | Listings page requests `/api/listings/source` twice | request probe | negligible | No | dedupe |
| M-08 | P3 | Architecture | One brokerage; no user-to-brokerage membership | `resolveActor` | Foreign isolation is record-level | No | membership before a second brokerage |
| M-09 | P3 | Transactions | A deal can be closed with no contract price (**known debt, pinned as current behaviour**) | atomicity suite | Money figures omit it and say so | No | require price to close |
| M-10 | P3 | Transactions | Deadlines cannot be added, edited or completed after creation | — | Home's attention queue shows deadlines that cannot be managed | No | see priorities |
| M-11 | P3 (test debt, fixed) | Harness | One-token specs went stale after ~60 s (zero-data, rendered-actions); fixtures had drifted (past follow-up date now refused; brokerage seed; a negation regex that rejected "can't"/"don't") | — | False failures | No | fixed; refreshing client everywhere |
| M-12 | P3 | Time | Metric windows, transaction deadlines and the AI follow-up validator still use UTC days | previous phase | same evening off-by-one outside follow-ups | No | move to the business day |

## 11. Cleanup

Preview returned to baseline exactly: 0 contacts, 0 activities, 0 transactions,
0 deadlines, 0 parties, 0 transaction events, 0 prepared actions; 1 user, 1
profile, 1 brokerage identity (fields identical to the pre-run snapshot), 0 MLS
links; certification role restored to `member`; no synthetic audit rows.
Normal sign-in audit rows remain, by convention. Production unchanged.

## 12. Verdict

**MASTER CHECKLIST PASS WITH ISSUES.** The agent can work, the broker can
supervise, the CRM and transactions are real, follow-ups are semantically honest,
authorization holds on every role, the database stayed clean, and the system does
not need AI to function. The "with issues" is the P3 register plus §9.

**Follow-up release: READY FOR SMALL PRODUCTION PROMOTION AUDIT.** The promotion
set is the follow-up work, the heading fix, and test-only changes.

## 13. Next priorities (by operational value)

1. **Transaction deadline add / edit / complete** — the working surface of a deal.
2. **Edit a contact and reassign it** — there is no route to fix a typo or hand a
   lead to another agent.
3. **Business-day correctness for deadlines and metric windows** (M-12).
4. **Create a contact or transaction from a listing** — link MLS to CRM.
5. **Calendar** for showings and closings, with reminders.
