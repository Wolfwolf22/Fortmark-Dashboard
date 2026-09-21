# The FortMark assistant

> The assistant answers from FortMark's own records, or it says it cannot. It
> has no third mode.

## Architecture

```
/ai thread  →  lib/ai/client.ts        plain-text stream, typed failures
                 └── POST /api/chat    Clerk session + dashboard allowlist
                       └── lib/ai/loop.ts        bounded tool loop
                             ├── lib/ai/stream.ts        events → text + tool calls
                             └── lib/ai/tools/execute.ts validate → run → structure
                                   └── lib/ai/tools/registry.ts
                                         ├── lib/contacts/service.ts
                                         ├── lib/transactions/service.ts
                                         ├── lib/{contacts,transactions}/metrics.ts
                                         ├── lib/metrics/service.ts
                                         └── lib/search/service.ts
```

Every arrow points at code the application already runs. There is no AI-only
query, no AI-only service and no AI-only table access: `get_contact` runs the
same `getContact` the contact drawer runs, and `search_entities` runs the same
providers ⌘K runs. If an agent cannot see a record on a screen, no amount of
asking gets it out of here.

## The tools

All nine are read only. There is no create, update, delete, send, upload or
schedule — not hidden behind a flag, not registered and disabled. **Not present.**

| Tool | Answers | Backed by |
|---|---|---|
| `search_entities` | a name or address → record ids | `lib/search/service.ts` |
| `get_contact` | one contact's detail | `getContact` |
| `get_transaction` | one deal's terms and milestones | `getTransaction` |
| `list_contacts` | the book of business | `listContacts` |
| `list_transactions` | the pipeline | `listTransactions` |
| `get_upcoming_deadlines` | overdue and imminent deadlines | `transactionAttention` |
| `get_followups` | follow-up dates that have arrived | `contactAttention` |
| `get_business_summary` | the headline numbers | `brokerageMetrics` |
| `get_recent_activity` | what changed recently | `{transaction,contact}Activity` |

## Authorization

The model cannot choose its own scope, and not because it is asked not to:
**no tool has a field for one.** Every schema is a `strictObject`, so a
`brokerage_id` or `agent_id` sent anyway fails validation and the call never
runs. Scope is resolved inside each tool from the verified Clerk user id
through the same `resolveActor` the screens use, and each query then carries
the same `visibleTo` predicate as its list screen.

Argument validation is server-side and unconditional: `executeTool` re-parses
every argument against the tool's own schema before a service is reached, and
a failure comes back as `invalid_arguments`. The provider is deliberately
*not* asked to enforce the schemas as well (`strict: true` is off): strict mode
limits which JSON Schema keywords a tool may declare, and a keyword it refuses
is a 400 on every turn — a total outage of the surface — to save the
occasional wasted round. Worth turning on once a deployment with a live key can
prove the schemas are accepted; not worth guessing at.

Existence is not leakable either. A record id belonging to another brokerage
returns `not_found` — the same answer as an id that never existed — so absence
of an error can never confirm that a record is out there.

The model never touches infrastructure. It has no database URL, no MLS
credential, no API key. It emits the *name* of a tool; the server decides
whether to run it, under whose identity, and what comes back.

## What the model cannot see

| | Why |
|---|---|
| Contact notes | the most sensitive free text in the CRM; out of scope in F1 |
| Documents and attachments | out of scope; no tool reads them |
| Email, calendar | out of scope |
| The compliance audit log | a record of who did what, not a data source |
| Internal ids | no brokerage id, no Clerk id, no agent user id — agents appear by name |
| The leaderboard | a privileged aggregate, deliberately not flattened for the model |

`lib/ai/tools/dto.ts` is the enforcement point: every result passes through a
function there, and each one is an allow-list that names the fields it copies.
A domain record that gains a field tomorrow does not start reaching the model
today.

## A failure is never an empty answer

| Code | Means |
|---|---|
| `not_found` | no such record is visible to this user |
| `not_configured` | this data source is not connected in this deployment |
| `not_permitted` | this user has no brokerage identity yet |
| `unavailable` | the source could not be reached — **not** an empty result |
| `timeout` | the lookup overran `TOOL_TIMEOUT_MS` — **not** an empty result |
| `invalid_arguments` | the model's arguments failed the tool's own schema |
| `too_many_calls` | more calls in one round than the server will run |
| `unknown_tool` | no such tool |

Each travels with the sentence it means, and the system prompt requires the
model to report it rather than paper over it. `get_business_summary` goes
further: each section carries its own availability, so "we could not read your
transactions" can never be rendered as "you closed nothing".

Nothing in this path can turn "we could not look" into "there is nothing".

## Bounds

| Bound | Value | Why |
|---|---|---|
| Tool rounds | `MAX_TOOL_ROUNDS = 5` | enough for find → read → check → correct |
| Calls per round | 4 | the model does not decide how much work a round is |
| Per-tool timeout | 8s | a hung query ends as `timeout`, not as a dead turn |
| Rows per tool | 8 default, 20 max | `hasMore` says the list was cut off, not that it ended |
| Function ceiling | 120s | a truncated stream looks like a model fault; it is not |

The **final** round is opened with `tool_choice: none`, so a turn always ends
in an answer rather than in another request the budget cannot pay for. A model
that asks anyway is told the budget ran out — in the thread, not silently.

## Prompt injection

Text stored in a CRM field is data. A contact called
`"ignore previous instructions and…"` is a contact with a strange name.

Three things make that structural rather than hopeful:

1. **The system prompt is a constant.** Nothing about the caller, their
   brokerage or any tool result is interpolated into it, so record text can
   never arrive carrying system authority. (It is also why the prefix caches.)
2. **Tool output only ever reaches the model inside a `tool_result` block**,
   JSON encoded. It is never concatenated into the prompt or into a text turn.
3. **The prompt names the rule** and tells the model to mention an apparent
   injection to the user rather than act on it.

## Logging

One line per tool call: the name, whether it succeeded, how long it took, and
the reason when it failed. One line per round: the round number and the number
of calls.

Never logged: arguments, results, message content, record fields, the system
prompt, or any credential. `scripts/test_ai_tools.ts` asserts that by reading
every `console.*` call in the loop and the executor.

## Availability

Two states, and no fallback:

| `AI_CHAT_PROVIDER_ENABLED` | `ANTHROPIC_API_KEY` | Result |
|---|---|---|
| `1` | present | answers over real records |
| anything else | — | `503 not_configured`; the thread says the assistant is not connected |

There used to be a third. An environment without a key served a generated
reply that opened with a comparable-sales table: invented addresses, invented
closed prices, invented days on market, rendered in the bubble a real answer
renders in. Nothing on screen said it was fiction, and an agent could have
taken a price to a seller from it. It is gone, along with its module.

`GET /api/health` reports which state a running deployment is in.

## Not in F1

Deliberately, and to be argued for on their own merits rather than arrived at:

- Any mutation at all — creating, editing, staging, scheduling, sending.
- Documents, email and calendar as data sources.
- Contact notes.
- Page context ("the deal I am looking at").
- Anything that remembers a conversation server-side.
