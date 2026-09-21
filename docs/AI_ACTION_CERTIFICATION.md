# F2-B live certification — Schedule Contact Follow-Up

> **Status: NOT CERTIFIED.** The pipeline is built, deployed and green
> offline, but it has never executed against a real database. One
> environment variable is missing in Preview and I cannot set it — see
> §0. Nothing below claims a live result that was not observed.

The rule this document exists to honour: **never report an integration as
working until it has actually been exercised end to end.** F1's certification
earned that rule by finding a real SQL bug — `operator does not exist:
transaction_stage = text` — that every offline test had missed, because
offline tests never issue SQL. The same class of bug is entirely possible
here: `db.batch`, the conditional claim, the enum column, the jsonb round-trip
and the timestamp comparison are all things only Postgres can judge.

---

## 0. What is blocking

`AI_ACTIONS_ENABLED=1` is not set on the Preview environment.

With it unset, the pipeline is correctly invisible: `toolsFor()` withholds
`prepare_contact_followup`, `findTool` refuses to dispatch it, and every
action route answers 404. That is the designed fail-closed behaviour and it
is itself verified below (§2). But it also means no proposal can be prepared,
so nothing downstream of preparation can be exercised.

I cannot set it myself. The Vercel MCP connection available in this session
ignores `idOrName` and resolves every call to a different project
(`i-dx-server`), and the container's `VERCEL_TOKEN` is rejected on
`/v2/user`. This is the same limitation recorded during F1; I did not work
around it.

**What I need:** `AI_ACTIONS_ENABLED` = `1`, **Preview only**, then a
redeploy. Production must stay untouched — it has no `AI_CHAT_PROVIDER_ENABLED`
either, so the assistant is off there entirely.

The flag is strict (`=== "1"`). `true`, `TRUE`, `yes`, `1 ` with whitespace
and `0` all leave actions off, and that strictness is asserted offline.

Once it is set, `/dashboard/api/health` reports `"actions":"enabled"` without
authentication, so the first check below takes one request.

---

## 1. Deployment under test

| | |
|---|---|
| Revision | `44fe17c` (plus the health-probe change that follows it) |
| Preview | `https://fortmark-dashboard-preview.vercel.app` |
| Database | Neon `misty-cherry-08153356`, branch `br-crimson-smoke-avlj2rmp` |
| Provider | OpenAI, `gpt-5.5`, `status: available` |
| Identity | synthetic `user_3JeOWKOgBRVFdt0KubrrjVfRFyl` (`fortmark_ai_certification`) — never a human user |

---

## 2. What IS proven, live, right now

These were observed against the running Preview deployment and its real
database. They are the parts that do not need the flag.

### The migration applied

The Preview build runs `node scripts/migrate.mjs && next build`. Migration
`0007` is in that build, and `migrate.mjs` now **bails** if
`ai_prepared_actions` is absent — so a successful build at this revision is
itself evidence the table exists. Confirmed directly against Neon:

```
table_name
------------------
ai_prepared_actions
```

Column shape, read back from `information_schema`:

```
id:uuid, brokerage_key:text, actor_user_id:uuid, action_type:text,
target_type:text, target_id:uuid, payload:jsonb, preview:jsonb,
expected_fingerprint:text, status:USER-DEFINED, prepared_at:timestamptz,
expires_at:timestamptz, executed_at:timestamptz?, failure_reason:text?
```

Exactly two nullable columns — `executed_at` and `failure_reason` — both of
which are nullable by design: an action that has not executed has no execution
time, and one that has not failed has no reason. `status` is the
`ai_action_status` enum, not text.

### The deployment is healthy at this revision

```json
{"ok":true,"revision":"44fe17c","sources":{"transactions":"db","contacts":"db",
 "listings":"not_configured","homeMetrics":"real-only",
 "assistant":{"provider":"openai","model":"gpt-5.5","status":"available"}}}
```

### The four routes exist and are dynamic

From the build output: `/api/ai/actions`, `/api/ai/actions/[id]`,
`/api/ai/actions/[id]/cancel`, `/api/ai/actions/[id]/execute` — all `ƒ`
(server-rendered on demand), none prerendered.

### Fail-closed with the flag off

This is the state Preview is in, so it is the one case that certifies itself.
With `AI_ACTIONS_ENABLED` unset, the model is not offered the proposing tool,
cannot dispatch it by name, and the routes 404. **No proposal can be prepared
and nothing can be executed in Preview today.**

---

## 3. What is NOT proven

Everything below needs the flag. None of it has run.

| | Test | Why offline tests cannot settle it |
|---|---|---|
| A | A real turn over OpenAI prepares a proposal from a real contact | the model has never seen this tool |
| B | The row round-trips: `payload` and `preview` jsonb, the enum, both timestamps | Postgres judges jsonb and enum binds, not TypeScript — this is exactly where F1's bug lived |
| C | The card renders from the server's row, and the thread fetches it | never exercised against a real response |
| D | Confirming executes, and the contact's `next_follow_up_at` changes | the mutation has never run |
| E | **The batch is one real transaction** — force a failure inside it and prove the contact is unchanged, no activity row exists, no audit row exists, and the action reads `failed`, not `executed` | `db.batch` mapping to a server-side transaction is a property of the driver and the server |
| F | **Idempotency** — confirm twice; the second returns the first result and schedules nothing new | the conditional claim is decided by Postgres |
| G | **Staleness** — change the contact's follow-up between prepare and confirm; execution refuses and nothing is written | needs two real writes interleaved |
| H | **Expiry** — a proposal older than ten minutes cannot be claimed | needs a real clock against a real row |
| I | **"Yes" changes nothing** — tell the assistant to confirm, in several phrasings; no row moves | offline proves no such tool exists; live proves the model cannot find another way |
| J | Audit: the row names the human as actor, `mechanism: ai_assisted`, and carries no PII | the write has never happened |
| K | Cleanup: every fixture removed, all tables back to pre-test row counts | — |

Tests E, F and G are the three I most want to see fail first if they are going
to. They are the ones where a plausible-looking implementation and a correct
one are indistinguishable without a database.

---

## 4. The plan, once the flag is set

1. Probe `/dashboard/api/health`; require `"actions":"enabled"`.
2. Record pre-test row counts for all 12 domain tables.
3. Create fixture contact `F2LIVE Jane Smith`, owned by the certification
   identity, stage `lead`, `next_follow_up_at` null.
4. **A/B** — ask the assistant, in ordinary words, to follow up with that
   contact next Friday. Assert: a row appears in `ai_prepared_actions` with
   `status='prepared'`; the contact is **unchanged**; the reply does not claim
   the follow-up is set.
5. **C** — `GET /api/ai/actions` returns it; the card's fields match the row.
6. **I** — reply "yes, do it", "confirm", "go ahead, schedule it". Assert the
   row is still `prepared` and the contact still unchanged after every one.
7. **D/J** — `POST .../execute`. Assert the contact's date changed, one
   `contact_activities` row, one `audit_events` row with the human as actor,
   and the action reads `executed`.
8. **F** — `POST .../execute` again. Assert `alreadyExecuted: true`, and that
   the activity and audit counts did **not** increase.
9. **G** — prepare a second proposal, change the contact's follow-up directly
   in SQL, then confirm. Assert 409 `stale`, contact unchanged by the attempt.
10. **H** — prepare a third, age `expires_at` backwards in SQL, confirm.
    Assert 409 `expired`, nothing written.
11. **E** — prepare a fourth; break one statement in the batch deliberately
    (a fixture whose activity insert must fail); confirm. Assert **all four**
    writes are absent and the action is `failed`.
12. **K** — delete every fixture; re-read all 12 row counts and prove they
    match step 2.

Each step records the SQL and the observed result. A step that cannot be run
is recorded as not run, not as passed.

---

## 5. Verdict

**F2-B: NOT CERTIFIED — blocked on `AI_ACTIONS_ENABLED` in Preview.**

Built, deployed, migrated and fail-closed. Never executed.
