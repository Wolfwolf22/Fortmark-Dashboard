# F2-C architecture review — AI-prepared contact stage change

> **Status: architecture and domain audit only.** Nothing is implemented. The
> tool registry is unchanged: nine read tools, one proposing tool
> (`prepare_contact_followup`), zero execution tools.

---

## 1. Recommendation

# PROCEED — `contacts.stage` is the correct mutation target

…with two prerequisites that are part of F2-C's own implementation, and one
scope question for you (§11).

The short reasoning, before the evidence:

- `contacts.stage` is the **only wired lifecycle dimension in the
  application**. It has real transition rules, exactly one writer, five
  downstream consumers, and a human UI that changes precisely this field.
- The opportunity dimension **exists in the schema but is inert**:
  `contact_opportunities.status` is written once at creation, never updated,
  and drives no metric, no screen and no rule. Redirecting F2-C there would
  not be redirecting an action — it would be building an entire lifecycle
  domain from scratch and then putting AI on top of it.
- The single-dimension limitation (§5) is **real but pre-existing**, and the
  human UI carries exactly the same exposure. AI does not introduce it.

I did not choose PROCEED because the brief is titled "contact lifecycle stage".
§6 asks whether contact stage is the right long-term target: for progression
semantics, **no** — opportunity is. But that is a CRM roadmap finding, not an
F2-C blocker, and §29 forbids redesigning opportunities now. The honest
position is recorded in §6 below rather than smuggled into the recommendation.

### Prerequisite 1 — extract one atomic stage-change operation (blocking)

`changeStage` is **not atomic today** (§7). F2-B's contract requires atomic
execution, and §31 forbids a parallel semantic path. Both must hold, so the
existing writer has to become a single atomic operation used by the UI *and*
by AI-confirmed execution. This is the `db.batch` extraction §22 anticipated.

### Prerequisite 2 — decide the follow-up interaction (blocking, small)

Moving a contact out of the open pipeline **silently suppresses an existing
follow-up** without clearing it (§8). That is defensible, but it is currently
invisible, and an AI-prepared stage change must disclose it. See §9.

---

## 2. The stage vocabulary (§2)

Eleven stages, from `lib/contacts/stages.ts`. Code and UI labels agree; no
terminology drift found.

| Persisted | Label | Active client? | Open pipeline? | Follow-ups surface? | Counted in lifecycle breakdown? |
|---|---|---|---|---|---|
| `lead` | Lead | no | **yes** | **yes** | yes |
| `contacted` | Contacted | no | **yes** | **yes** | yes |
| `qualified` | Qualified | no | **yes** | **yes** | yes |
| `appointment` | Appointment | no | **yes** | **yes** | yes |
| `representation` | Representation | **yes** | **yes** | **yes** | yes |
| `active_client` | Active client | **yes** | **yes** | **yes** | yes |
| `under_contract` | Under contract | **yes** | **yes** | **yes** | yes |
| `closed` | Closed | no | no | **no** | yes |
| `past_client` | Past client | no | no | **no** | yes |
| `lost` | Lost | no | no | **no** | **no** (exit) |
| `archived` | Archived | no | no | **no** | **no** (exit) |

`closed` and `past_client` have **no special handling anywhere** beyond falling
out of the active and open-pipeline sets. Neither is tied to transaction
closure, and neither triggers any behaviour of its own.

---

## 3. The transition graph (§3)

From `canTransition`. One authoritative source; AI must reuse it unchanged.

```
same stage                      -> refused (not a transition)

any lifecycle -> any lifecycle  -> allowed   (order is not enforced)
any lifecycle -> lost|archived  -> allowed
lost          -> any lifecycle  -> allowed   (reopened)
lost          -> archived       -> allowed
archived      -> lead           -> allowed   (explicit restore, ONLY target)
archived      -> anything else  -> refused
```

The lifecycle is deliberately permissive: a referral can arrive already at
`representation`, and correcting a mis-set stage must not require an exit and
re-entry. **`archived` is the only near-terminal state** — its single way back
is `lead`, which discards where the person had got to.

---

## 4. What actually changes when `contacts.stage` changes (§1)

Five consumers, and no others. Search does not use stage; no report uses it.

| Consumer | Rule | Effect of a change |
|---|---|---|
| `brokerageMetrics.activeClients` | `stage ∈ {representation, active_client, under_contract}` | count moves immediately |
| `brokerageMetrics.followUpsDue` | `next_follow_up_at ≤ today AND stage ∈ OPEN_PIPELINE` | a due follow-up appears/disappears |
| `contactAttention` (Needs Attention) | same predicate, limit 50 | row appears/disappears |
| lifecycle pipeline breakdown | grouped over the 9 `LIFECYCLE_STAGES` | one column loses a contact, another gains one |
| F2-B `followUpWarnings` | `stage ∈ OPEN_PIPELINE` | changes whether a follow-up proposal warns |
| Leads screen | filter + badge label | filtered view membership |

**No coupling to transactions.** `transaction_parties.contact_id` and
`contact_opportunities.transaction_id` both exist, with indexes, and **neither
is ever read or written by any service**. Nothing derives contact stage from
transaction state, and no invariant prevents marking a contact `lost` while a
linked transaction is live — because the link is not populated in the first
place (§7 answered).

---

## 5. Is stage really one dimension? (§5)

**No, and this is the audit's most important structural finding.**

`contacts.stage` is a single global value per *person*, but it is being used to
express at least three different things:

- qualification progress (`lead` → `contacted` → `qualified` → `appointment`)
- representation status (`representation`)
- engagement/outcome (`active_client`, `under_contract`, `closed`,
  `past_client`, `lost`)

The canonical failure is real: Jane is a **past buyer** and becomes a **new
seller lead**. There is exactly one field, so one of those two truths has to be
discarded. Moving her to `lead` erases that she was ever a client; leaving her
`past_client` hides that she is in the pipeline — and drops her out of
`followUpsDue` and Needs Attention entirely.

Does AI amplify it? **Somewhat.** Natural language makes "mark Jane as lost"
trivially easy to issue without the record in front of you, where the UI at
least requires opening her drawer. The confirmation card mitigates this — it
shows From → To from server truth — but the card cannot show what the *other*
dimension would have said, because there is no other dimension.

This is a pre-existing limitation, not one F2-C creates, and §29 forbids fixing
it now. It is recorded here as a roadmap item (§6).

---

## 6. Contact vs opportunity (§6, §28)

`contact_opportunities` already has the right shape for per-need progression:

```
kind         buyer | seller | landlord | tenant | investor |
             commercial_* | referral_source
status       open | won | lost | dormant
transactionId -> transactions.id
```

That is precisely the model that would let Jane be a won buyer opportunity and
an open seller opportunity at once.

**But it is inert.** Repository truth:

- `status` is written **only** at contact creation (defaults `open`) and never
  updated by any service;
- `transactionId` is **never written**;
- no metric, screen, filter or rule reads `status`;
- opportunities are read only to project intent/budget/area onto the contact
  DTO, and searched by `area`.

So "REDIRECT to opportunity" would not redirect the action. It would require
first building: an opportunity status lifecycle with transition rules, a
writer, activity/audit semantics, metrics that consume it, and UI to show it —
and only then an AI action on top. That is a CRM phase, not an AI phase.

**Recommendation:** proceed on `contacts.stage` now; record opportunity-level
progression as the correct long-term target. When it is built, contact stage
should become *derived* from opportunity state rather than independently
editable — at which point an AI action on contact stage would be retired, not
migrated. F2-C should therefore be considered explicitly reversible in
direction, and is worth building only because it also builds the shared atomic
writer the UI needs anyway (§7).

---

## 7. The existing stage writer (§22, §31)

`changeStage` in `lib/contacts/service.ts` — the single writer, used by the
Leads drawer through `POST /api/contacts/:id/stage`.

Sequence today:

1. read contact under `visibleTo`, then `canSee` / `canWrite`
2. `canTransition(from, to)` → `invalid_transition`
3. `update contacts set stage …`
4. `insert contact_activities` (`kind: status_change`, `summary: "Stage changed from X to Y"`, `safeMetadata: {from, to}`)
5. `recordAudit(…, "contact_stage_changed", {from, to})`
6. re-read and return

**Two defects, both flagged rather than fixed (§45 forbids turning this into
implementation):**

1. **Not atomic.** Steps 3–5 are sequential awaits. A failure after step 3
   leaves the stage changed with no activity and no audit — a silent
   history gap on the exact field an audit exists for.
2. **The activity insert swallows its own failure.** It is wrapped in
   `try { … } catch { /* History must never break the write it describes. */ }`.
   The intent is sound for a UI write; the effect is that history can go
   missing with nobody told.

F2-C must not bypass this function, and must not fork it. The correct shape is
to extract one atomic operation — the same four writes inside a single
`db.batch` — and have both the UI route and AI-confirmed execution call it.
That removes the swallow for both paths at once, which is why Prerequisite 1
is worth doing rather than worked around.

---

## 8. Follow-up interaction (§9) — documented, not changed

Traced, not assumed:

- `changeStage` **never touches `next_follow_up_at`.** The date is retained
  verbatim across every transition, including into `lost` and `archived`.
- `followUpsDue` and `contactAttention` both require
  `stage ∈ OPEN_PIPELINE_STAGES`, so leaving the open pipeline makes a stored
  follow-up **stop appearing** without being cleared.
- Moving back into any open-pipeline stage **restores it**, still with its
  original date — which may by then be in the past, in which case it
  immediately reads as overdue.

**Is this surprising? Yes, in one direction.** Suppression is invisible: a
person marked `lost` on Monday still has Friday's follow-up stored, sees no
trace of it, and if reopened in March acquires an overdue follow-up they never
re-scheduled. Retaining the date is the right call (it is information, and
reopening should not lose it); *silently* suppressing it is the part worth
surfacing.

**Recommendation:** do not change the behaviour. Disclose it on the card for
transitions that cross the open-pipeline boundary (§10).

This also interacts with F2-B: `followUpWarnings` already warns when scheduling
a follow-up on a non-open-pipeline contact. The two disclosures should use the
same wording so the pair is coherent.

---

## 9. Risk classification (§41)

**MODERATE**, and not uniformly so.

Not `low`: a confirmed change alters brokerage reporting the instant it
commits — `activeClients` is a headline Home number. Not `external`: nothing
leaves FortMark, nobody is contacted, no money moves.

Consequence tiers, from actual effects rather than intuition:

| Tier | Transitions | Why |
|---|---|---|
| **Low** | movements among `lead`, `contacted`, `qualified`, `appointment` | pipeline-breakdown column only; no active-client, no follow-up change |
| **Moderate** | into or out of `{representation, active_client, under_contract}` | changes the **Active Clients** headline metric |
| **High** | into `lost`, `closed`, `past_client` | leaves the open pipeline: **silently suppresses any stored follow-up** and drops out of Needs Attention |
| **Highest** | into `archived` | all of the above **and** near-terminal: the only way back is `lead`, which discards the person's accumulated standing |

### On "reversible" (§42)

A stage change is **re-settable, not reversible.** Setting it back restores the
field and the metrics, but the history is permanent by design: each change
writes a `status_change` activity and a `contact_stage_changed` audit event,
and those remain. Two corrections leave three rows. A contact bounced through
`lost` and back carries that in its CRM history forever, which is correct
behaviour and precisely why "you can just change it back" should not be used
to argue the action is consequence-free.

`archived → lead` is the one case that is genuinely lossy: the original stage
is recoverable only by reading the audit trail, not by the transition.

---

## 10. The proposed action (§11, §16, §17, §32, §33, §34)

**Action type:** `contact_stage_change`
**Tool:** `prepare_contact_stage_change`
**Risk:** `moderate`

### Tool input — minimal, server derives the rest

```ts
{ contactId: string; toStage: ContactStage }
```

Refused by construction: `fromStage`, `brokerageId`, `agentId`, `actorId`,
`currentStage`. The schema is `strictObject`, so a smuggled field fails the
whole call rather than being ignored — the same property F2-B asserts.

### Preview

```
Change contact stage

Jane Smith

Current      Qualified
New          Active client

This contact will be counted in Active Clients.
```

One deterministic consequence line, drawn from the table below, and only when
the transition actually crosses one of these boundaries. No line otherwise —
§17's "do not overfill the card".

| Crossing | Line |
|---|---|
| into `ACTIVE_CLIENT_STAGES` | "This contact will be counted in Active Clients." |
| out of `ACTIVE_CLIENT_STAGES` | "This contact will no longer be counted in Active Clients." |
| out of `OPEN_PIPELINE_STAGES` **with a follow-up stored** | "Their follow-up on {date} will be kept but will no longer appear in your follow-ups due." |
| into `archived` | "Archived contacts can only be restored to Lead." |

Every line is derived from a predicate in `lib/contacts/stages.ts` and is true
or false with no judgement. The model authors none of it.

### Copy

- prepared: "I've prepared the stage change for your review."
- after success: "Jane Smith is now an Active client."
- buttons: `Cancel` / `Confirm`

---

## 11. Scope question for you

§3 says do not create AI-specific transition rules, and I agree — validity must
come from `canTransition` alone. But *which target stages this phase
authorizes* is a scope decision, exactly as F2-B authorized one action out of
many, and it is yours rather than mine.

**My recommendation: exclude `archived` from F2-C.** It is the only
near-terminal stage, its recovery path is lossy, and it is the one transition
where a confirmed mistake cannot be fully undone through the UI. Everything
else in the lifecycle is re-settable. Excluding it costs little — archiving is
a deliberate filing action, not something worth doing conversationally.

If you prefer no restriction, the `archived` consequence line in §10 is the
minimum disclosure I would want in its place.

---

## 12. Fingerprint (§18)

```
{ id, stage }
```

Contact id and current stage only. Stage is the sole input to transition
validity, so nothing else can invalidate a prepared stage change.

Deliberately **excluded**: `next_follow_up_at`. A colleague scheduling a
follow-up between prepare and confirm does not change whether the transition is
valid, and invalidating the action would be noise. Note this differs from
F2-B's fingerprint, which includes `nextFollowUpAt` because that *is* the field
it writes — each action fingerprints what it depends on, not a shared set.

No whole-row `updated_at`: an email or name edit must not invalidate the
action.

Authorization is re-evaluated separately at execution and is not part of the
fingerprint.

---

## 13. Expiry (§19)

**Reuse `ACTION_TTL_MS` (10 minutes) unchanged.** No per-action TTL. Nothing
about a stage change argues for a different window, and a second constant would
invite a third. If ten minutes proves wrong it is wrong for both actions and
should change in one place.

---

## 14. Atomic execution (§20, §21, §23)

Execution order, no shortcut because preparation already authorized:

1. authenticate actor (Clerk) → 2. resolve dashboard identity → 3. load the
prepared action → 4. verify actor ownership → 5. verify brokerage → 6. status
is `prepared` → 7. not expired → 8. re-read the contact under `visibleTo` +
`canWrite` → 9. recompute fingerprint → 10. re-run `canTransition` →
11. conditional claim (`prepared → executing`), which is the mutex and the
idempotency key.

Then one `db.batch`:

```
1. update contacts set stage = :to, updated_by_user_id = :actor, updated_at = now
2. insert contact_activities  kind = 'status_change'
                              summary = 'Stage changed from X to Y'
                              safe_metadata = { from, to, mechanism: 'ai_assisted',
                                                preparedActionId }
3. insert audit_events        event_type = 'contact_stage_changed'
                              actor_user_id = the confirming human
                              safe_metadata = { from, to, mechanism: 'ai_assisted',
                                                preparedActionId, targetId }
4. update ai_prepared_actions set status = 'executed', executed_at = now
```

`contact_stage_changed` is already in the closed `RELEASE_1_AUDIT_EVENTS` list,
so no schema change is needed and **no migration 0008 is required** (§29).

Note writes 1–3 are exactly what `changeStage` does today — which is the point:
after Prerequisite 1 this batch *is* the shared operation, not a copy of it.

**The human is the actor.** The model's involvement appears only as
`mechanism: ai_assisted`.

---

## 15. Authorization tests (§25)

No new AI roles; the existing `visibleTo` / `canSee` / `canWrite` predicates
decide everything.

- agent prepares against their own contact → prepared
- agent prepares against another agent's private contact → `not_found`
- privileged role follows the existing policy, not a new one
- foreign brokerage → `not_found`, indistinguishable from nonexistent
- action prepared by A cannot be executed by B → `404`
- action cannot move a contact across brokerages (brokerage is a column, never
  an input)

---

## 16. Test plan (§35–§39)

**Preparation:** valid forward; valid reverse; `archived → qualified` refused;
same stage → no row, "already in that stage" (§15 — matches the UI, which
guards `stage === lead.stage`); into `lost`; recovery out of `lost`;
unauthorized contact; foreign brokerage; ambiguous name → **no row written**;
contact deleted between search and prepare; database unavailable. **No
`ai_prepared_actions` row on any failure path.**

**Execution:** successful atomic transition; activity written; audit written;
action `executed`; no mutation before confirmation; typed "yes" does nothing;
expired; stale (stage moved underneath); wrong actor; foreign brokerage;
duplicate execute; concurrent execute; forced batch failure → full rollback.

**Metric regression** — exact cases from §4, not assumed semantics:

- `qualified → active_client` increments `activeClients` by exactly 1
- `active_client → lost` decrements it by 1 **and** removes the contact from
  `followUpsDue` and `contactAttention` while `next_follow_up_at` stays set
- `lost → qualified` restores it to `followUpsDue` with the original date
- the lifecycle breakdown moves exactly one contact between two columns

**Search regression:** after execution, the contact's search result reflects
the new stage — no stale projection.

**AI context regression (live):** after a confirmed change, "What stage is Jane
in now?" must return the new value from a read tool, not from the model
recalling what it proposed.

**Provider parity:** identical schema to OpenAI and Anthropic; no
provider-specific stage action.

---

## 17. The UI certification gap (§30)

**Finding.** F2-B's Confirm button was never clicked in a rendered DOM. Clerk's
official Playwright flow authenticates correctly — the browser holds a valid
session for the synthetic user, and `azp` is
`https://fortmark-app-preview.vercel.app` — but the **portal's** server-side
check does not accept it: the portal root renders signed-out and every
`/dashboard/*` request redirects to `/sign-in`. The dashboard deployment
accepts the very same session as a Bearer token, which is how F2-B was
certified.

So this is not a Clerk testing-tool limitation and not a dashboard bug. The
dashboard's `authorizedParties` already accepts this token; the portal is a
separate application (`fortmark-app`, Next 16 `proxy.ts`) whose own
configuration rejects it.

**Recommendation: fix it once, at the portal configuration level, before F2-C
lands — and do not weaken anything to do it.** Concretely: inspect the portal's
`proxy.ts` `authorizedParties` and Clerk configuration against the dashboard's,
which is known-good. The most likely cause is that the portal does not list its
own Preview origin, which would be a configuration omission rather than a
security control.

I recommend fixing it rather than accepting the split because F2-C doubles what
the untested surface costs: two actions will share one confirmation component,
and a rendered-card test would then cover both. If the portal turns out to
require a genuine authentication change rather than a configuration
correction, **stop and decide deliberately** (§28's stop condition) — an E2E
convenience is not worth an auth change.

Interim position: the split is acceptable for Preview certification. The
execute route, its payload and its refusals are live-certified; only the button
and its rendering are offline-only, and those are asserted in
`scripts/test_ai_actions.ts`.

---

## 18. Registry state (§44)

Unchanged by this review:

| | |
|---|---|
| read tools | 9 |
| propose tools | 1 (`prepare_contact_followup`) |
| F2-C tools | **0** |
| execution tools callable by the model | **0** |

`ToolEffect` remains `"read" | "propose"`. No migration, no lifecycle change,
no flag change, no new stage field.
