# AI providers

> FortMark decides what may be read, by whom, and how far. A provider decides
> only what to say. Either vendor can be the second thing; neither can become
> the first.

---

## The shape

```
  /api/chat                       Clerk session + dashboard allowlist
      ↓
  lib/ai/providers/select.ts      AI_PROVIDER → vendor, model, key
      ↓
  lib/ai/loop.ts                  rounds, budgets, history      ← FortMark
      ↓
  lib/ai/providers/types.ts       text and tool calls, nothing else
      ↓                                                         ── the line ──
  ├── providers/anthropic.ts      Messages API                  ← a vendor
  └── providers/openai.ts         Responses API
      ↓
  lib/ai/tools/registry.ts        the nine read-only tools      ← FortMark
      ↓
  contacts · transactions · metrics · search services
```

Everything above the line is FortMark's and runs identically whoever answers:
the tool registry, the authorization, the DTOs, the round budget, the per-call
timeout, the audit logging, the failure vocabulary. Everything below it is one
company's wire protocol.

An adapter's entire job is to translate. It defines no tool, reads no record,
resolves no actor, validates no argument, counts no round and enforces no
timeout — and `scripts/test_ai_providers.ts` asserts each of those against both
adapters' source, so "the abstraction stayed thin" is checked rather than
hoped for.

## The vocabulary between them

Four types, in `lib/ai/providers/types.ts`. A turn is some text and some tool
calls; that is all either vendor is asked for and all either may contribute.

Three things are deliberately absent:

| Not in the contract | Why |
|---|---|
| a stop reason | whether to run tools is decided by whether tool calls arrived, not by a vendor's word for why it stopped — one fewer concept to map, and no way for the two to disagree |
| reasoning | there is no event for it, so forwarding it would mean changing the contract first |
| a credential | an adapter is handed the one key it needs; it never reads the environment and never sees the other vendor's |

## Environment

| Variable | Meaning |
|---|---|
| `AI_CHAT_PROVIDER_ENABLED` | `1`, exactly, or the assistant is off. Strict, because it authorises spending against an external account. |
| `AI_PROVIDER` | `anthropic` or `openai`. Unset means `anthropic`. Anything else is refused. |
| `AI_MODEL` | Optional override. Server-side only. |
| `ANTHROPIC_API_KEY` | Required when `anthropic` is selected. |
| `OPENAI_API_KEY` | Required when `openai` is selected. |

**Only the selected vendor's key is required, and only the selected vendor's
key is ever read.** Neither is ever a `NEXT_PUBLIC_` value, neither reaches a
browser bundle, and both are read in one server-only module.

### Default models

| Vendor | Default | Overridden by |
|---|---|---|
| `anthropic` | `claude-opus-5` | `AI_MODEL` |
| `openai` | `gpt-5.5` | `AI_MODEL` |

Both are their family's current flagship. The browser never chooses a model:
the composer's `mode` field has never been read, because a caller-chosen model
is a caller-chosen bill.

## No fallback, in any direction

This is the rule the whole selection exists to enforce:

- `AI_PROVIDER=anthropic` with no Anthropic key → the assistant is
  **unavailable**. It does not use OpenAI because a key for it happens to be
  present.
- `AI_PROVIDER=openai` with no OpenAI key → likewise, in reverse.
- `AI_PROVIDER=openAI`, `claude`, `gpt` → **refused**. Not coerced,
  not lower-cased into a guess.
- No key at all → unavailable. There is no generated reply behind the
  assistant and no other mode; the one that used to exist opened with an
  invented comparable-sales table.

Two reasons, and both matter. Certification has to know which vendor answered
a question — a silent substitution makes every result meaningless. And in
ordinary use, a substitution would send a brokerage's client records to a
company nobody chose.

## Health

```json
"assistant": { "provider": "openai", "status": "available" }
```

| `status` | Means |
|---|---|
| `available` | the selected vendor has its key and the flag is on |
| `disabled` | `AI_CHAT_PROVIDER_ENABLED` is not `1` |
| `no_credential` | the **selected** vendor's key is absent |
| `invalid_provider` | `AI_PROVIDER` names a vendor this build does not implement (`provider` is then `null`) |

The checks run in a deliberately different order from the gate. The gate looks
at the flag first and never reads a credential when the assistant is off,
which is right for a gate and useless for a report: it would answer `disabled`
to an operator whose key is also missing, who would switch it on and come
straight back for the second half. The probe names the step that would still
be blocking.

No value, no variable content and no fragment of a key is disclosed by any of
it — only which vendor is selected and which setup step remains.

## Tool parity

One registry, rendered twice:

| | Anthropic | OpenAI |
|---|---|---|
| Definition | `tools: [{ name, description, input_schema }]` | `tools: [{ type: "function", name, description, parameters }]` |
| Call | `tool_use` content block | `function_call` output item |
| Result | `tool_result` block in one user message | `function_call_output` input items |
| Final-round ban | `tool_choice: { type: "none" }` | `tool_choice: "none"` |

Both renderings are generated from `READ_ONLY_TOOLS` by a `.map`. The tests
assert the two vendors receive the same tools, in the same order, with the
same descriptions and byte-identical schemas — so "show me my active
transactions" reaches `listTransactions` under the same `visibleTo` predicate
either way.

Neither request sets strict/structured schema enforcement. The registry's
schemas carry length and range bounds that guide a model well, strict modes
restrict which keywords a tool may declare, and a refused keyword is an error
on every turn. The enforcement that matters is server-side and unconditional:
every argument is re-parsed against the same schema in `executeTool` before a
service is reached.

## Limits are FortMark's

| Bound | Enforced in |
|---|---|
| 5 tool rounds | `lib/ai/loop.ts` |
| 4 calls per round | `lib/ai/tools/execute.ts` |
| 8s per tool | `lib/ai/tools/execute.ts` |
| Final round cannot call tools | the loop, honoured by each adapter's own mechanism |

None of these is delegated to a vendor. A provider that ignored its
instruction not to call tools would still be stopped by the round counter, and
one that hung would still be cut off by the timeout.

## Streaming, and what never reaches the UI

Both adapters stream text as it arrives, and both drop everything else:
reasoning text, reasoning summaries, argument fragments, refusal deltas,
annotations, and every server-tool event neither integration uses. There is no
branch that would let them through, because `TurnEvent` has no case for them.

The UI is asserted not to name a vendor, import a vendor SDK, or handle a
vendor protocol. It receives plain text and does not know who wrote it.

### OpenAI specifics worth knowing

- **`store: false` on every request.** The Responses API retains responses by
  default so they can be fetched later. A FortMark turn contains a brokerage's
  client records, and FortMark does not get to decide on its clients' behalf
  that a vendor should keep a copy. Nothing here depends on retrieval.
- **Tool calls are read from `response.output_item.done`**, which carries the
  finished call with complete arguments, rather than reassembled from
  `function_call_arguments.delta`. Nothing half-parsed reaches the executor.
- **No reasoning summary is requested**, so none is produced to leak.

## Certification

F1 live certification selects a vendor with `AI_PROVIDER` and requires that
vendor's key in **Preview only**. Because there is no fallback, a certification
run cannot be answered by the vendor it did not select — which is what makes
its results mean anything. Run the matrix once per vendor to certify both.

`GET /api/health` reports which vendor a deployment is on, and
`scripts/migrate.mjs` prints the same at build time (presence only, never a
value).

## Adding a third

1. A name in `ProviderName`.
2. An adapter exporting `openRound`, `classify`, and its translations.
3. A default model in `DEFAULT_MODEL` and a key name in `CREDENTIAL_VARIABLE`.
4. A branch in the route.

No tool, no service, no DTO, no limit and no test of FortMark's behaviour
changes — and the parity suite gains a third column rather than a second copy.
