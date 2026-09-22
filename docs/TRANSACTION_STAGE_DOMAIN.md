# Transaction stage domain

> **Status: atomic domain infrastructure, no AI capability.** The manual stage
> writer is one authoritative operation whose writes commit together. No AI
> tool proposes transaction stage changes and none is authorized.

---

## 1. Stages

Eleven, from `lib/transactions/stages.ts`. Six active, four terminal, one
paused.

| Persisted | Label | Active? | In pipeline count/volume? | Closed metrics? | Stamps a date |
|---|---|---|---|---|---|
| `opportunity` | Opportunity | **yes** | **yes** | no | — |
| `offer` | Offer | **yes** | **yes** | no | — |
| `under_contract` | Under contract | **yes** | **yes** | no | — |
| `due_diligence` | Due diligence | **yes** | **yes** | no | — |
| `financing` | Financing | **yes** | **yes** | no | — |
| `closing_prep` | Closing prep | **yes** | **yes** | no | — |
| `on_hold` | On hold | no (counted separately) | no | no | — |
| `closed` | Closed | no | no | **yes** | `closed_date` |
| `cancelled` | Cancelled | no | no | no | `cancelled_date` |
| `withdrawn` | Withdrawn | no | no | no | `cancelled_date` |
| `fell_through` | Fell through | no | no | no | `cancelled_date` |

`on_hold` has its own count (`onHoldCount`) and is deliberately outside the
active set, so pausing a deal removes it from pipeline value without pretending
it ended.

## 2. Transition graph

From `canTransition`, the single source:

```
same stage                     -> refused (not a transition)
terminal -> anything           -> refused (nothing leaves a terminal stage)

active -> forward any distance -> allowed
active -> back exactly one     -> allowed   (a reopened contingency)
active -> back two or more     -> refused
active -> on_hold              -> allowed
active -> cancelled/withdrawn/fell_through -> allowed
active -> closed               -> ONLY from closing_prep
on_hold -> any active stage    -> allowed
on_hold -> terminal            -> refused
```

Two properties worth stating because a future AI capability would inherit
them: **closing is reachable from exactly one stage**, and **every terminal
stage is a one-way door** — there is no reopen path in the domain at all.

## 3. Downstream consumers

| Consumer | Rule |
|---|---|
| `activeCount`, `activeVolume`, `unpriced`, `scheduled` | `stage ∈ ACTIVE_STAGES` |
| `onHoldCount` | `stage = on_hold` |
| `closedCount`, `closedVolume` | `stage = 'closed'` **and** `closed_date` within the month |
| Kanban | buckets by stage; `cancelled`/`on_hold` have their own rows |
| Transactions table, drawer, filters, search | display and filter only |
| Commission | **not stage-dependent** — `projectCommission` reads stored money only |
| Deadlines | **untouched by stage changes** |

Closed metrics depend on `closed_date` as well as the stage, which is why the
writer stamps it.

## 4. The defect this phase removed

`changeStage` performed **three independent writes**:

1. `update transactions` — on its own;
2. `insert transaction_events` — inside a `try`;
3. `insert audit_events` — inside the **same** `try`.

Both history writes shared one `catch { }`. So a failure in the event insert
skipped the audit insert as well, both were swallowed, and the function
returned success — leaving a deal whose stage had moved with **nothing at all
recording that it had**. On the record that carries the money and the closing
date, that is the worst place in the application for a silent history gap.

## 5. The shared operation

```
planStageChange(ctx, id, to, { mechanism?, metadata?, now? })
  -> authorize   visibleTo + canSee + canWrite
  -> validate    canTransition (which refuses same-stage)
  -> derive      from = row.stage          (never supplied by a caller)
  -> build       three writes, unperformed
  -> return      { row, from, to, writes }

commitStageChange(db, writes)
  -> db.batch(writes)   one Neon HTTP server-side PostgreSQL transaction

changeStage(ctx, id, to, now)   the manual path, used by the pipeline UI
  -> plan, commit, re-read
```

The planned writes:

```
1. update transactions
     stage, updated_by_user_id, updated_at,
     closed_date    = today when moving to closed, otherwise unchanged
     cancelled_date = today when moving to another terminal stage, otherwise unchanged
2. insert transaction_events   event_type transaction_stage_changed, { from, to }
3. insert audit_events         event_type transaction_stage_changed,
                               { transactionId, from, to }
```

Returning the writes rather than performing them is the whole point: a second
caller appends its own statement to this list instead of reimplementing the
authorization, the lifecycle rule and the date handling around a copy. That is
what the contacts refactor proved, and what makes a future AI-confirmed
execution a one-line addition rather than a second writer.

**Preserved exactly:** transitions, authorization, labels, kanban behaviour,
metric definitions, commission arithmetic, deadline semantics, the event
summary shape, and the audit conventions. A manual change records no
`mechanism`, so existing history stays comparable.

**Proven against the real database:** the actual three-statement batch with the
audit insert forced to violate a foreign key left the stage at `closing_prep`,
`closed_date` null, `updated_by_user_id` null, zero events and zero audits.
The same three with a valid actor committed together: `closed`, closed date
stamped, cancelled date still null, price and deadlines untouched, exactly one
event and one audit.

**Mutation-tested:** reverting the commit to sequential awaits fails 2 checks,
dropping the audit write from the plan fails 4, and letting a stage change
clear `closed_date` fails 1.

## 6. Terminal-state findings, for a future decision

These are recorded because they decide what an AI capability could safely
propose. **None is implemented.**

### `closed`

- Reachable **only from `closing_prep`** — the domain already refuses closing
  from anywhere else.
- Stamps `closed_date` to today. There is no way to close with a different
  date through this path, and no way to close without one.
- **Immediately changes reporting**: `closedCount` and `closedVolume` move as
  soon as it commits, and the deal leaves `activeCount`/`activeVolume`.
- **Not reversible.** `canTransition` refuses every move out of a terminal
  stage, so closing is a one-way door in the domain, not merely discouraged.
- `contract_price_cents` is **not required** — a deal can close with no price,
  which would silently contribute zero to closed volume.
- Commission is **not finalised** by closing; it remains a projection from
  stored terms.
- Documents are **not** checked.

### `cancelled` / `withdrawn` / `fell_through`

- All three stamp `cancelled_date` and are equally irreversible.
- Remove the deal from pipeline count and volume immediately.
- Leave deadlines and money untouched.
- The domain draws no distinction between them beyond the label, so a model
  choosing among them would be choosing on vocabulary alone.

### `on_hold`

- The only pause, and the only non-active stage with a way back.
- Reversible to any active stage, which makes it the least consequential
  non-active move.

## 7. What a future transaction-stage AI capability would still need

Recorded as architecture input. **Not authorized, not implemented.**

- **Risk: higher than contact stage.** A contact stage change moves a headline
  count. A transaction stage change moves money in reporting, stamps a date
  that cannot be un-stamped, and cannot be undone at all.
- **Fingerprint:** `{ id, stage }` by the same reasoning as contacts — stage is
  the sole input to transition validity. `closed_date` should *not* be
  included: it is written by the transition, not consulted by it.
- **Scope recommendation:** if a capability is ever authorized, start with
  **active-stage moves only** — forward, back-one, and `on_hold` in both
  directions. Exclude `closed` and the three cancellation stages, exactly as
  `archived` was excluded from contact stage. The reasoning is stronger here:
  those four are irreversible in the domain itself, and `closed` additionally
  rewrites the brokerage's closed production for the month.
- **Consequence disclosure** a card would owe: entering or leaving the active
  set (pipeline value), and for `closed` the closed-production effect and the
  fact that it cannot be undone.
- **Open question before closing could ever be proposed:** should closing
  require a contract price? Today it does not, and a closed deal with no price
  contributes zero to closed volume without saying so. That is a product
  decision, not a refactor.
