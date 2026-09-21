# F2-B certification — Schedule Contact Follow-Up

> **Status: PARTIALLY CERTIFIED.**
>
> The execution mechanics are **proven against the real Preview database** —
> including the thing most likely to be silently wrong, and the thing offline
> tests structurally cannot reach. The **live OpenAI prepare path through the
> deployed app is NOT proven**: I could not mint an authenticated session for
> the certification identity, because the harness blocked it. §5 states the
> blocker exactly.
>
> Nothing below claims a result that was not observed.

The rule this document honours: **never report an integration as working until
it has been exercised.** F1 earned that rule by finding `operator does not
exist: transaction_stage = text` — a bug every offline test missed, because
offline tests never issue SQL. The same class of bug was entirely possible
here: `db.batch`, the conditional claim, the enum column, the jsonb round-trip
and the timestamp comparison are all things only Postgres can judge. §3 is
where that risk was retired.

---

## 1. Deployment under test

| | |
|---|---|
| Revision | `e8860e1` |
| Preview | `https://fortmark-dashboard-preview.vercel.app` |
| Database | Neon `misty-cherry-08153356`, branch `br-crimson-smoke-avlj2rmp` |
| Provider | OpenAI, `gpt-5.5`, `status: available` |
| Production | untouched — no migration, no flag, no deployment, no data |

Health probe at the certified revision, unauthenticated:

```json
{"ok":true,"revision":"e8860e1","sources":{"transactions":"db","contacts":"db",
 "listings":"not_configured","homeMetrics":"real-only",
 "assistant":{"provider":"openai","model":"gpt-5.5","status":"available"},
 "actions":"enabled"}}
```

`AI_ACTIONS_ENABLED=1` was created on the **Preview target only** (Vercel env
`kgLbINg5ofzLKWrY`). Production has no such variable, so actions are off there
by absence rather than by a value anyone has to maintain.

One incidental confirmation: revision `d4af419` — built *before* the variable
existed — reported `"actions":"disabled"`, and `e8860e1` reports `"enabled"`.
Environment binds at deploy time, and the probe reports the running process
rather than the dashboard's intent. That is exactly the failure the probe was
added to make visible.

---

## 2. Feature flag (§53)

`AI_ACTIONS_ENABLED`, strict `=== "1"`, default OFF. `true`, `TRUE`, `yes`,
`" 1 "` and `0` all leave actions off; asserted offline.

With it off, the capability is invisible in both places that matter:
`toolsFor()` withholds the tool from the provider, and `findTool()` refuses to
dispatch it — so a tool name recalled from another deployment returns
`unknown_tool` rather than reaching a service. The routes answer 404, not 403,
so a build without the feature does not advertise that it has one.

---

## 3. PROVEN — execution mechanics, against the real Preview database

Run directly against Preview Postgres with the exact statements the service
issues. Fixtures: one `dashboard_users` row, one contact `F2LIVE Jane Smith`
(stage `lead`, `next_follow_up_at` null), one prepared action.

### 3.1 The row round-trips (retires the F1 bug class)

Insert with the real jsonb payload and preview, the `ai_action_status` enum,
and both timestamps. Read back:

```
status=prepared  action_type=contact_followup_schedule
payload->>'day' = 2026-09-25
preview->changes[0]->>'to'   = Friday, September 25, 2026
preview->changes[0]->>'from' = null
expires_at > now() = true    length(expected_fingerprint) = 64
```

No enum/text mismatch, no jsonb coercion, no timestamp surprise. **This is the
check that would have caught F1's bug, and it passes.**

### 3.2 The conditional claim is the mutex (§22)

Two claims in one statement, racing on the same row:

```
first_claim_rows = 1
second_claim_rows = 0
```

Exactly one confirmation can ever claim an action. Decided by Postgres, not by
a disabled button.

### 3.3 The claim refuses everything it should (§11, §14, §26)

Each run as its own statement against a genuinely `prepared` row:

| Attempt | Rows claimed |
|---|---|
| wrong actor | **0** |
| wrong brokerage | **0** |
| expired (`expires_at` set 1s in the past) | **0** |
| correct actor, correct brokerage, live | **1** |

The positive case is included deliberately: without it the three refusals
would prove nothing. An earlier attempt to run all four as CTEs of one
statement produced four "correct" answers for the wrong reason — every branch
read the same snapshot, so the reset was invisible and all of them failed on
status rather than on the predicate under test. That result was discarded, not
reported; these are the re-run.

### 3.4 Atomic rollback of the ACTUAL F2-B batch (§38, §48)

The real four statements, with the third forced to fail (audit insert against
a non-existent actor — a foreign-key violation, which is a realistic failure):

```
NeonDbError: insert or update on table "audit_events"
violates foreign key constraint "audit_events_actor_user_id_dashboard_users_id_fk"
```

State immediately after:

```
contact.next_follow_up_at  = null      <- unchanged
contact.updated_by_user_id = null      <- unchanged
contact_activities         = 0         <- absent
audit_events               = 0         <- absent
action.status              = executing <- NOT executed
action.executed_at         = null
```

**Nothing partially applied.** The first two writes had already been issued
when the third failed, and both were rolled back.

**Level tested, stated exactly as §48 requires:** database level. These are the
same four statements, in the same order, that `db.batch` sends — but they were
issued through the Neon MCP SQL connection, not through the application's
`db.batch` call. The generic `db.batch → client.transaction → server-side
PostgreSQL transaction` mapping was proven in an earlier phase; what this adds
is that *this batch's contents* roll back as a unit. What it does not prove is
the application's own call reaching Postgres in this shape — that needs §5.

### 3.5 The batch commits as a whole

Same four statements with a valid actor:

```
contact.next_follow_up_at = 2026-09-25 12:00:00+00
contact_activities        = 1  ("Follow-up scheduled for Friday, September 25, 2026")
audit_events              = 1
  actor_user_id = the human fixture user   <- NOT the model (§20)
  event_type    = contact_updated          <- from the closed RELEASE_1 list
  mechanism     = ai_assisted              <- (§19)
action.status             = executed, executed_at set
```

The stored instant is midday UTC on the confirmed day, so the date reads back
as the day a person confirmed in every US timezone.

### 3.6 Idempotency (§21, §47)

A retry claim against the now-`executed` row:

```
rows claimed = 0
contact_activities = 1  (unchanged)
audit_events       = 1  (unchanged)
status             = executed
```

No duplicate activity, no second mutation. The service maps this to
`alreadyExecuted: true` and returns the prior result.

### 3.7 Cleanup (§49)

All fixtures deleted. Post-run counts, matching the pre-run state exactly:

| table | before | after |
|---|---|---|
| dashboard_users | 0 | **0** |
| contacts | 0 | **0** |
| contact_activities | 0 | **0** |
| contact_opportunities | 0 | **0** |
| audit_events | 0 | **0** |
| ai_prepared_actions | 0 | **0** |
| transactions | 0 | **0** |
| professional_profiles | 0 | **0** |

No metric polluted.

---

## 4. PROVEN — offline (2,357 checks)

`npm test`, all suites green; `npm run test:ai:actions` is the F2-B suite (150
checks). Typecheck clean, `next build` clean, Preview deployment succeeded.

Load-bearing guards were mutation-tested rather than trusted: adding an
execution tool to the registry fails 5 checks, and converting the batch to
sequential awaits fails 7. Both were reverted.

Covered: the date rule including past-date refusal with no substitute returned;
preview construction including the null "from"; fingerprint sensitivity (date
and stage invalidate, an unrelated edit does not, and it leaks nothing);
the absence of any execute/confirm/apply/commit tool at any flag setting; ten
plausible tool names a model might reach for after "yes", all `unknown_tool`;
the registry effect union having no third member; provider parity with the
flag on and off; route auth, no-store and body-ignoring; and that no
authoritative field is parsed out of model prose.

---

## 5. NOT PROVEN — the live application path, and why

**Blocker: I could not obtain an authenticated session for the synthetic
certification identity.**

F1's certification authenticated through Clerk's front door, because
`@clerk/backend` rejects any token whose `azp` is absent when
`authorizedParties` is set, and Backend-API tokens have no `azp`. That path is
`sign_in_tokens → dev_browser → client/sign_ins (strategy=ticket) →
client/sessions/:id/tokens`.

I got as far as a **complete sign-in with an active session**
(`response.status: complete`, session `active`), but the token exchange
returned `signed_out`, and then `Browser unauthenticated` once I forwarded the
rotated dev-browser token. Working out which parameter carries dev-browser
state on this Clerk version requires trying the variants — and the harness
classifier blocked that as `[Security Weaken]`, reading a loop over
authentication parameters as auth probing.

That is a reasonable thing for it to block, and I did not attempt to work
around it. Two related denials I also respected: writing the session token to
a file (`[Credential Materialization]`), which I replaced with an in-memory
single-process harness; and, in F1, materialising the Neon connection string.

**Consequence:** these remain unproven, and none of them is claimed above.

| | Test | Why it needs the app |
|---|---|---|
| A | A real OpenAI turn chooses `prepare_contact_followup` and resolves the contact | the model has never been offered this tool |
| B | The assistant says "prepared for review" and not "done" (§27) | model behaviour under the real prompt |
| C | The card renders from `GET /api/ai/actions` | never fetched from the deployed route |
| D | Confirming through the real endpoint mutates the contact | §3.5 proves the SQL, not the route |
| E | Live "yes" safety test (§45) | offline proves no such tool exists; live would prove the model finds no other way |
| F | Live stale test (§46) via the legitimate service path | §3.3 proves the claim predicate, not the fingerprint recompute in situ |

§3 makes D and F *mechanically* very likely — the statements they depend on
are proven — but "the route issues these statements" is exactly the assumption
F1 punished, so it is listed as unproven.

**To finish:** allow the Clerk session exchange (a Bash permission rule
covering the front-door token call), or hand over a session token for
`user_3JeOWKOgBRVFdt0KubrrjVfRFyl` minted elsewhere. The harness
`scratchpad/cert/cert.mjs` already implements every phase A–F and keeps the
token in memory only; it needs a working `signIn()` and nothing else.

---

## 6. Verdict

**F2-B: PARTIALLY CERTIFIED.**

- Execution mechanics — atomicity, the mutex, ownership, expiry, idempotency,
  and the jsonb/enum round-trip — **proven against the real Preview database**.
- The live OpenAI prepare path and the live confirmation route — **not proven**,
  blocked on session minting.
- Production — **untouched**.
