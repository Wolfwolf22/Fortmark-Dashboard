# AI action certification — F2-B and F2-C

> F2-C (contact stage change) is certified in
> **`docs/AI_CONTACT_STAGE_ACTION.md` §19**, alongside the domain audit that
> shaped it. This document remains the F2-B record.

# F2-B — Schedule Contact Follow-Up

> **Status: LIVE VERIFIED.** Every gate was observed against the deployed
> Preview, including expiry against the real ten-minute clock.
>
> The pipeline was exercised end to end against the deployed Preview with a
> real Clerk session, the real middleware, the real allowlist, the real OpenAI
> model and the real database:
>
> natural language → OpenAI proposes → server-built preview → human confirms →
> atomic write → audit → no duplicate, no replay, no overwrite.

---

## 1. Authentication — Clerk's official testing flow, no bypass

Authentication uses **`@clerk/testing`** with Playwright, which is Clerk's
supported mechanism for automated authenticated tests:

```
Playwright
  → clerkSetup()               Testing Token for this run
  → setupClerkTestingToken()   lets the automated browser past bot protection
  → clerk.signIn()             a real Clerk sign-in, development instance
  → synthetic certification user
  → normal Clerk session
  → normal FortMark middleware, authorizedParties, allowlist, actor resolution
```

**Nothing was weakened to make this pass.** `authorizedParties` was not
relaxed, the middleware was not modified, no test-only auth path exists in the
application, and neither human user's session was used or requested. The point
of the run is the opposite: that the *existing* security architecture accepts a
legitimately authenticated synthetic user and nothing else.

That it is genuinely enforcing is visible in how the run progressed — each
failure named the next real gate, and each was resolved by configuring the
synthetic identity, never by loosening a rule:

| Stage | First result | Resolution |
|---|---|---|
| Clerk signature / `azp` | `401 Unauthorized` | none needed — the front-door session carries `azp: https://fortmark-app-preview.vercel.app`, which the dashboard's `authorizedParties` already accepted |
| FortMark allowlist | passed | the identity was already allowlisted in Preview |
| Actor resolution | `403 no_identity` | loaded the dashboard shell, whose layout runs the application's own `syncCurrentUser` |
| Record ownership | `403` on contact create | the synthetic user was `member`; **`member` cannot own records** — so its Clerk `publicMetadata.fortmarkRole` was set to `agent`, the server-controlled role source a real agent is provisioned through |

Certification identity: `user_3JeOWKOgBRVFdt0KubrrjVfRFyl`,
`fortmark.ai.certification+clerk_test@example.com`, synthetic, Preview only.

**Token hygiene (§23):** authentication happens on the portal origin while the
dashboard is a separate deployment, and a cross-origin fetch from the page is
refused by CORS — a browser rule, not an auth result. The runner therefore
issues those requests itself with the session token taken from the
authenticated Clerk browser object **in memory only**. No token is written to
disk, printed, committed, or captured: traces, screenshots and video are all
disabled in `playwright.config.ts`, and `e2e/.auth/`, `test-results/` and the
report directories are gitignored.

---

## 2. Deployment under test

| | |
|---|---|
| Preview revision | `79e799f` |
| Portal origin | `https://fortmark-app-preview.vercel.app` |
| Dashboard origin | `https://fortmark-dashboard-preview.vercel.app` |
| Database | Neon `misty-cherry-08153356`, branch `br-crimson-smoke-avlj2rmp` |
| Provider / model | OpenAI, `gpt-5.5` |
| `AI_ACTIONS_ENABLED` | `1`, **Preview target only** |
| Production | untouched |

---

## 3. The live run

All nine steps passed in one serial run (`npm run certify:f2b`).

### §12 — the real model prepares, and changes nothing

Asked, in ordinary words: *"Schedule a follow-up with F2LIVE Jane Smith next
Friday."* OpenAI resolved the contact and called `prepare_contact_followup`.

Assistant reply, verbatim:

> "I've prepared that follow-up with F2LIVE Jane Smith for Friday, September
> 25, 2026. It's waiting for you to confirm it in the FortMark interface; the
> contact won't be updated until you press Confirm there."

Prepared action, as the server returned it to the browser:

```json
{"type":"contact_followup_schedule","status":"prepared",
 "summary":"Schedule a follow-up with F2LIVE Jane Smith for Friday, September 25, 2026",
 "changes":[{"field":"nextFollowUpAt","label":"Follow-up",
             "from":null,"to":"Friday, September 25, 2026"}],
 "confirmationRequired":true}
```

Contact after preparation: `nextFollowUpDate` **absent**. Nothing mutated.

### §13 — the card's values, and where they come from

Every field above is built by the server from the stored row and fetched over
`GET /api/ai/actions`; none is parsed out of the model's prose. `from: null`
renders as "No follow-up scheduled", and `to` is an absolute date — asserted
against `/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/`, so "next Friday"
could not satisfy it.

**Level tested:** the card's *payload* was verified live; the button click
itself was driven through the execute route rather than a rendered DOM,
because the dashboard UI is reached through the portal origin whose server-side
session check rejects this session (§6). The offline suite asserts that the
card renders only these fields and parses nothing from model text.

### §14 — the "yes" safety gate — **PASS**

Typed into the chat: *"yes, do it"*. The assistant replied:

> "I can't confirm it from chat. Please use the **Confirm** button on the
> prepared follow-up card in FortMark; typing "yes" here does not schedule it."

Contact unchanged. Action still `prepared`. No execute call occurred, and none
could: the model holds no tool that commits.

### §15/§16 — confirmation commits, and only then — **PASS**

`POST /api/ai/actions/:id/execute` → `200`, `alreadyExecuted: false`,
action `executed`.

```
contact.nextFollowUpDate = 2026-09-25T12:00:00.000Z
```

Midday UTC on exactly the day the card named. All four writes in the batch,
read back from the database:

| Write | Observed |
|---|---|
| contact follow-up | `2026-09-25T12:00:00.000Z` |
| CRM activity | `task \| Follow-up scheduled for Friday, September 25, 2026 \| ai_assisted` |
| audit event | `contact_updated \| actor=1ecddb13-… \| ai_assisted \| field=nextFollowUpAt` |
| action status | `executed` |

**§20 — the human is the actor.** The audit row names the confirming user, not
the model; the model's involvement is recorded as `mechanism: ai_assisted`.

### §17 — idempotency — **PASS**

Second `POST …/execute` → `200`, `alreadyExecuted: true`, status `executed`.
Verified in the database afterwards: still **exactly one** `ai_assisted`
activity and **exactly one** `ai_assisted` audit row. No second mutation.

### §18 — stale action — **PASS**

A second action was prepared, then the contact's follow-up was moved to
`2026-12-01` **through the legitimate domain path** (`POST
/api/contacts/:id/activities`, the same call a colleague logging a touch
makes). Confirming the older action:

```
409 {"error":"stale"}
contact.nextFollowUpDate = 2026-12-01T12:00:00.000Z   <- newer value preserved
```

The action row reads `stale`. Nothing was overwritten.

### §19 — expired action — **PASS**

An action prepared at `23:48:39` and expiring at `23:58:39` was confirmed
after its window had genuinely elapsed. The TTL was never shortened.

```
offered in the pending list : false
direct read                 : status=expired, expiresAt=2026-09-21T23:58:39.675Z
confirm                     : 409 {"error":"expired"}
contact.nextFollowUpDate    : absent  <- untouched
```

Expiry is evaluated against the clock rather than written into the row by a
sweeper, so a lapsed action still sits in the table as `prepared`. That is the
point of this test: neither the read path nor the execute path treats it as
live, so no sweeper is load-bearing for safety.

### §20 — unauthorized / unknown action — **PASS**

An action id that is not this caller's returns `404 {"error":"Not found"}` —
identical to one that never existed, and the body carries nothing about a
contact, a date or a brokerage. Wrong-actor and wrong-brokerage claim
predicates were additionally proven at the database level (§5).

### §21 — atomicity

**Level tested, stated exactly as §21 and §48 require: database/integration
level.** The application exposes no injected-failure mode, and per §21 none was
built — a production-reachable failure switch is a worse thing to own than an
untested path. The existing proof is retained: the real four-statement batch
was run against Preview Postgres with the audit insert forced to violate a
foreign key, and **nothing partially applied** — contact unchanged, no
activity, no audit, action `executing` rather than `executed`. Detail in §5.

---

## 3b. Incidental finding — §4 ambiguity, verified live

A repeat run left two contacts with the same name. Asked to schedule a
follow-up for that name, the assistant **prepared nothing** — no
`ai_prepared_actions` row was written at all. §4 requires exactly that: where
more than one contact is plausible, do not prepare, ask which.

It surfaced as a test failure rather than as a designed check, which is worth
saying plainly: the product behaved correctly and the harness was wrong to
reuse a fixture name. The fixture name is now unique per run.

---

## 4. Cleanup (§22) — complete

Every certification fixture was deleted and all twelve domain tables returned
to their pre-run values.

| table | before | after run | after cleanup |
|---|---|---|---|
| dashboard_users | 0 | 1 | **0** |
| professional_profiles | 0 | 1 | **0** |
| profile_images | 0 | 1 | **0** |
| contacts | 0 | 4 | **0** |
| contact_activities | 0 | 6 | **0** |
| contact_opportunities | 0 | 0 | **0** |
| audit_events | 0 | 7 | **0** |
| ai_prepared_actions | 0 | 4 | **0** |
| transactions | 0 | 0 | **0** |
| transaction_parties | 0 | 0 | **0** |
| transaction_deadlines | 0 | 0 | **0** |
| transaction_events | 0 | 0 | **0** |

No metric polluted; nothing retained in the database.

The application actor was deleted too, rather than kept. It is not a fixture
worth preserving: the app recreates it on the next sign-in through its own
`syncCurrentUser`, and it comes back as `agent` because the role lives in Clerk
metadata rather than in the row.

What remains is only the synthetic Clerk identity itself — non-human, Preview
only, `fortmarkRole: agent`, which §22 permits and the next run needs.

---

## 5. Database-level proofs (retained)

Run directly against Preview Postgres with the exact statements the service
issues. These cover what only Postgres can judge, and they are what retires the
F1 bug class (`operator does not exist: transaction_stage = text`).

- **Round-trip:** jsonb payload and preview, the `ai_action_status` enum, both
  timestamps, 64-hex fingerprint — all read back intact.
- **The claim is a mutex:** two claims racing on one row returned **1** and
  **0**.
- **The claim refuses:** wrong actor **0 rows**, wrong brokerage **0 rows**,
  expired **0 rows**, correct-and-live **1 row**. The positive case is included
  so the refusals are not vacuous.
- **Atomic rollback of the actual batch:** forced FK violation on the audit
  insert → contact unchanged, no activity, no audit, action not `executed`.
- **Commit as a whole:** all four writes land together, human as audit actor.

---

## 6. Known gaps

1. **The card was not clicked in a rendered DOM.** Its payload was verified
   live and its rendering is asserted offline, but the browser UI path is not
   reachable for this session: the dashboard is served through the portal
   origin, and the portal's server-side session check does not accept this
   session even though the browser holds a valid one (the cookie-path finding
   from F1 — Bearer works, the cookie does not, on this development instance).
   Closing this properly means changing the Preview authentication topology,
   which §28 reserves for a deliberate decision rather than a workaround.
2. **Application-level injected failure** does not exist, by choice (§21).
   Atomicity is proven at database/integration level.
3. **Wrong-actor execution at API level** was proven by indistinguishability
   (404) rather than by signing in a second synthetic identity; the predicate
   itself is proven at database level.

---

## 7. Real-clock expiry run (§19) — **PASS**

**The TTL was not reduced for the test** — shortening it would prove only that
a shortened window closes. Result in §3 §19: an action expired on the real
clock was refused with `409 expired`, was not offered as pending, read back as
`expired`, and left the contact untouched.

Getting there took three attempts, and the two failures were both harness
defects rather than product faults. They are recorded because a certification
that hides its own false starts is worth less:

1. **Hung at `clerk.loaded()`** — Clerk's script did not finish initialising on
   one page load and the helper waited fifteen minutes. Fixed with a bounded
   three-attempt reload; an unbounded wait turns a real failure into a silent
   timeout.
2. **Session token expired mid-wait** — the token captured at sign-in did not
   outlive a ten-minute test. That is Clerk behaving correctly; the harness was
   wrong to assume otherwise. The page now stays open and tokens are refreshed
   from the live session, and the call asserts a `200` before reading its body
   so an auth problem surfaces as one.

A third run then failed on the §4 ambiguity rule (§3b) — the product being
right, the fixture name being reused. Names are now unique per run.

Two specs are retained: `e2e/expiry.spec.ts` prepares an action and waits out
the real TTL end to end, and `e2e/expired-action.spec.ts` verifies an
already-aged action by id (`EXPIRED_ACTION_ID`, `EXPIRED_CONTACT_ID`), which is
the fast way to re-check the refusal without a ten-minute wait.

---

## 8. Verification

| | |
|---|---|
| Playwright certification | 9/9 passed (`npm run certify:f2b`) |
| Playwright expiry | 2/2 passed, self-contained, 10.5m (`npm run certify:f2b:expiry`) |
| Offline suites | 2,357 checks passed (`npm test`) |
| Typecheck | clean |
| Build | clean |
| Preview revision | `79e799f` |
| Production impact | **none** |

Pre/post domain counts: all twelve domain tables 0 before and 0 after — see §4.

---

## 9. Test infrastructure retained (§24)

Kept as repeatable Preview certification infrastructure, `devDependencies`
only and never imported by application code:

| Path | Purpose |
|---|---|
| `@clerk/testing`, `@playwright/test` | dev dependencies |
| `playwright.config.ts` | traces/screenshots/video off; serial, no retries |
| `e2e/global.setup.ts` | `clerkSetup()` — Testing Token for the run |
| `e2e/session.ts` | official sign-in helper; token in memory only |
| `e2e/f2b-certification.spec.ts` | the nine-step live certification |
| `e2e/expiry.spec.ts` | self-contained real-clock expiry proof (~10.5m) |
| `e2e/expired-action.spec.ts` | fast re-check of an already-aged action, by id |

Run with `npm run certify:f2b`. It needs `CLERK_SECRET_KEY` and a publishable
key for the **development** instance (`cheerful-anteater-89.clerk.accounts.dev`)
in the runner's environment; it never reads Production credentials.

---

## 10. Verdict

**F2-B: LIVE VERIFIED** for the prepare → preview → "yes"-is-inert →
confirm → atomic write → audit → idempotent → stale-refused pipeline, every
step observed against the real deployment.

Two items remain open and are not claimed as passed: the API-level expiry run
(§7, proven at database level only) and fixture cleanup (§4). The gaps in §6
are stated rather than papered over.
