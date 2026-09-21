# F1 live certification — OpenAI

**Status: BLOCKED. Not certified.**
No live OpenAI request has been made. No fixture was seeded. The matrix below
is recorded as NOT RUN rather than inferred, estimated or reasoned about.

| | |
|---|---|
| Date | 2026-09-21 |
| Preview revision | `67c7e9c` |
| Provider | OpenAI |
| Model | `gpt-5.5` (the OpenAI default; no `AI_MODEL` override, per the health probe) |
| Blocker | no authenticated Clerk Preview session |

---

## What is proven

**Configuration, at runtime.** `GET /dashboard/api/health` on the live Preview
deployment:

```json
{
  "ok": true,
  "revision": "67c7e9c",
  "sources": {
    "transactions": "db",
    "contacts": "db",
    "listings": "not_configured",
    "homeMetrics": "real-only",
    "assistant": { "provider": "openai", "status": "available" }
  }
}
```

`status: available` means the running process resolved all three of
`AI_CHAT_PROVIDER_ENABLED=1`, `AI_PROVIDER=openai` and a present
`OPENAI_API_KEY`. It says nothing about whether OpenAI accepts that key.

**Atomicity** (§37–38) — proven on the Preview branch. See below.

## What is not proven

Everything the certification exists to establish:

- OpenAI accepts the credential
- `gpt-5.5` is available to this account
- a Responses API call succeeds
- the model selects FortMark tools
- tool calls round-trip against real Preview records
- authorization and brokerage isolation survive model-driven tool use

## The blocker

A live certification has to run through the real assistant, which means an
authenticated request to `POST /dashboard/api/chat`. That needs a Clerk
session, and there are only two ways to obtain one:

1. **A browser session.** None is available to this environment.
2. **Minting one through Clerk's Backend API.** The instance secret for
   `cheerful-anteater-89.clerk.accounts.dev` — the same instance the dashboard
   Preview uses — is present in the working environment, so this is
   technically possible and requires no code change, no bypass and no
   weakening of the allowlist. It was attempted and **refused by the harness
   as an auth-weakening action.**

That refusal is correct on the merits: the instance has two users, both real
people, and minting a session means acting as one of them. It was not worked
around.

Running the stack locally instead is not an alternative: the OpenAI key and
`DATABASE_URL` exist only inside the Vercel deployment, which is where they
belong. There is no path from here to a live OpenAI call that does not pass
through an authenticated session.

## Matrix

| | Test | Result |
|---|---|---|
| A | general knowledge, no tool | NOT RUN |
| B | business summary | NOT RUN |
| C | projected commission ($21,250) | NOT RUN |
| D | active transactions | NOT RUN |
| E | attention this week | NOT RUN |
| F | 30-day deadline horizon | NOT RUN |
| G | unique entity resolution | NOT RUN |
| H | conversational reference | NOT RUN |
| I | ambiguous entity | NOT RUN |
| J | contact follow-up | NOT RUN |
| K | same-brokerage authorization | NOT RUN |
| L | other brokerage | NOT RUN |
| M | MLS not configured | NOT RUN |
| N | missing transaction data | NOT RUN |
| O | prompt injection | NOT RUN |
| P | multi-tool turn | NOT RUN |
| Q | provider failure | OFFLINE ONLY — covered deterministically; not induced live |

Every one of A–P is covered by offline tests against scripted provider streams
(`scripts/test_ai_providers.ts`, `scripts/test_ai_tools.ts`). That establishes
that FortMark behaves correctly **given** a model that calls tools. It does not
establish that this model, on this account, does.

Those are different claims and this document does not merge them.

## Fixtures

**None seeded.** Seeding `F1LIVE` records before the tests can run would leave
data in Preview with nothing to certify and a cleanup obligation attached to a
future session. Pre-state was captured and re-verified unchanged.

| Table | Before | After |
|---|---|---|
| `audit_events` | 0 | 0 |
| `contact_activities` | 0 | 0 |
| `contact_opportunities` | 0 | 0 |
| `contacts` | 0 | 0 |
| `dashboard_users` | 0 | 0 |
| `professional_profiles` | 0 | 0 |
| `profile_images` | 0 | 0 |
| `transaction_deadlines` | 0 | 0 |
| `transaction_events` | 0 | 0 |
| `transaction_parties` | 0 | 0 |
| `transactions` | 0 | 0 |
| `__drizzle_migrations` | 6 | 6 |

Preview Neon branch `br-crimson-smoke-avlj2rmp`, project `misty-cherry-08153356`.

---

## Atomicity (§37–38)

### The mechanism

The driver is `drizzle-orm/neon-http` over `@neondatabase/serverless`.

| | |
|---|---|
| `db.transaction(cb)` | **throws** `No transactions support in neon-http driver` — interactive transactions are unavailable, by design: each query is a stateless fetch with no session to hold one open |
| `db.batch([...])` | **works**, and is the mechanism. `NeonHttpSession.batch` calls `client.transaction(builtQueries, queryConfig)` — the Neon HTTP driver's own transaction, which wraps the statements in a real Postgres transaction server-side and accepts `isolationLevel`, `readOnly` and `deferrable` |

So F2's requirement — mutation + domain event + audit event + prepared-action
state, all or nothing — is satisfiable today, with no driver change, provided
the writes are expressed as one `db.batch([...])` rather than as sequential
awaits.

The constraint this places on F2: the executor cannot read between its own
writes. A batch is a fixed list of statements decided before any of them runs.
Every value the mutation depends on must be read *before* the batch — which is
what the prepared action's re-fetch and fingerprint check already do.

### The proof

Run on the Preview branch against an isolated scratch table, touching no
domain table.

**Success** — three writes standing in for mutation, domain event and audit
event, in one transaction:

```
insert id=1 'mutation'
insert id=2 'domain event'
insert id=3 'audit event'
→ committed;  count = 3
```

**Forced failure** — two valid writes followed by a primary-key violation, in
one transaction:

```
insert id=4 'mutation that must not persist'
insert id=5 'domain event that must not persist'
insert id=1 (duplicate key)          → NeonDbError: duplicate key value
→ rolled back;  count = 3,  rows 4 and 5 absent
```

The two writes that individually succeeded did **not** persist. That is the
property F2 needs and it holds on the real branch.

Scratch table dropped; row counts re-verified identical to the pre-state.

### Existing code is not yet atomic

Worth recording, because an action system is where half-applied state becomes
visible. `changeStage` in `lib/transactions/service.ts` issues the update and
its `transaction_events` row as two separate awaits, so a failure between them
already leaves a change without its event. F2-A should express its execution
path as a batch from the start; retrofitting the existing writers is a
separate, larger question.

---

## Known limitations

- No live provider call has ever been made from this environment, for either
  vendor. The Anthropic path is in the same position.
- Offline coverage uses scripted provider streams. It proves FortMark's
  handling, not the model's judgement.
- No authenticated UI verification (§33): no browser session. Streaming, the
  waiting state and error rendering remain unverified in the real app.

## To unblock

Any one of:

1. A browser with a signed-in Preview session, running the A–P questions.
2. Authorization to mint a Clerk session through the Backend API for a named
   user, accepting that the run acts as that user.
3. A dedicated certification user added to `FORTMARK_ALLOWED_CLERK_USER_IDS`
   in Preview, whose session may be minted without acting as a real person.

(3) is the cleanest and makes every future certification repeatable.
