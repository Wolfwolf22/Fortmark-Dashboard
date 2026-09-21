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
| Blocker | two Preview environment variables (below) |
| Certification identity | `user_3JeOWKOgBRVFdt0KubrrjVfRFyl` — synthetic, created |

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

## The certification identity

Created in the Preview Clerk instance (`cheerful-anteater-89.clerk.accounts.dev`,
development, confirmed to be the instance the active Preview deployment uses).
It is not a person and neither human account was touched.

| | |
|---|---|
| User id | `user_3JeOWKOgBRVFdt0KubrrjVfRFyl` |
| Username | `fortmark_ai_certification` |
| Name | FortMark AI Certification |
| Email | `fortmark.ai.certification+clerk_test@example.com` |
| Password | none (`skip_password_requirement`) |
| `public_metadata` | `{ environment: "preview", purpose: "ai_certification", human: false }` |
| `private_metadata` | `{ synthetic: true, not_for_production: true }` |

The email uses `example.com` — reserved by RFC 2606 and never routable — plus
Clerk's `+clerk_test` convention, so no verification mail can reach a real
person. The metadata is inert: FortMark authorization reads the allowlist and
the `dashboard_users` table, never Clerk metadata.

The id was validated against the application's own `parseAllowlist`, alone and
alongside an existing entry. This matters more than it looks: that parser
fails the **whole** allowlist closed on a single malformed entry, so a bad id
would lock every user out of the dashboard.

**Lifecycle:** the identity persists for future certification runs. It holds no
business data. Its application-side actor (dashboard user / brokerage) has not
been created yet and will be, as Preview-only fixture, when certification can
actually run.

## The blocker

Two Preview environment variables, both outside this environment's reach: the
Vercel connection available here resolves to a different project (it returns
an environment containing the shared `FORTMARK_ALLOWED_CLERK_USER_IDS` but
none of the dashboard's `DATABASE_URL`, `AI_PROVIDER` or `OPENAI_API_KEY`,
which the live health probe proves the dashboard has).

### 1. The allowlist

`FORTMARK_ALLOWED_CLERK_USER_IDS` must gain `user_3JeOWKOgBRVFdt0KubrrjVfRFyl`,
appended to the existing entries, **Preview only**.

### 2. Authorized parties — the less obvious one

A server-minted session is rejected before the allowlist is ever consulted.
`middleware.ts` passes `authorizedParties` to `clerkMiddleware`, and
`@clerk/backend` enforces:

```js
var assertAuthorizedPartiesClaim = (azp, authorizedParties) => {
  if (!authorizedParties || authorizedParties.length === 0) return;
  if (!azp || !authorizedParties.includes(azp)) throw TokenInvalidAuthorizedParties;
};
```

A token with **no** `azp` is rejected whenever the list is non-empty — which it
always is in Preview. Session tokens from the Backend API
(`POST /v1/sessions/{id}/tokens`) carry no `azp`, so that route can never
authenticate here. This is the anti-replay hardening working exactly as
designed; it simply also excludes a legitimate certification harness.

The supported front-door path does produce a proper `azp`:

```
POST /v1/sign_in_tokens                    (Backend API)   → ticket
POST /v1/dev_browser                       (Frontend API)  → dev browser token
POST /v1/client/sign_ins  strategy=ticket  (Frontend API)  → session + JWT
```

Verified working: `sign_in status: complete`, one session, `sub` = the
certification user, and `azp` set to the `Origin` the exchange was made from.
The dashboard still returned 401 for it, because the origins reachable from
here are not in its authorized-party list, whose contents
(`CLERK_AUTHORIZED_PARTIES`, `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`,
`VERCEL_BRANCH_URL`) cannot be read from outside the deployment.

`CLERK_AUTHORIZED_PARTIES` exists in the middleware precisely as the
"explicit operator-provided list", so adding the certification origin to it in
**Preview only** is the intended mechanism rather than a workaround.

Neither change touches Production, weakens verification, or creates a bypass:
the allowlist still governs who may enter, and `azp` verification still rejects
tokens minted for any other origin.

Running the stack locally instead is not an alternative: the OpenAI key and
`DATABASE_URL` exist only inside the Vercel deployment, which is where they
belong.

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

In the `fortmark-dashboard` Vercel project, **Preview scope only**, then
redeploy the branch:

1. `FORTMARK_ALLOWED_CLERK_USER_IDS` — append
   `user_3JeOWKOgBRVFdt0KubrrjVfRFyl`, keeping every existing entry.
2. `CLERK_AUTHORIZED_PARTIES` — append the origin the certification harness
   signs in from, `https://fortmark-dashboard-preview.vercel.app`.

Both are additive. Neither is needed in Production, and neither should be set
there.

Afterwards the harness authenticates through the front door as a synthetic
user, passing the same Clerk verification and the same allowlist as any
person, and the A–Q matrix can run.
