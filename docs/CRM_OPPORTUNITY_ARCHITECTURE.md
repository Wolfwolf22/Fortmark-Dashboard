# CRM Opportunity architecture

> **Status: architecture review. Nothing here is implemented.**
> No schema change, no migration, no service, no UI, no AI tool. The AI
> registry is unchanged at 9 read / 2 propose / 0 execute, and F2-B and F2-C
> behave exactly as they did.

**Decision: B — the concept is right, the schema needs structural revision
before implementation.** Reasoning in §12.

---

## 1. What exists today

### 1.1 `contacts`

Twenty columns, carrying four different kinds of fact:

| Concern | Columns |
|---|---|
| Tenancy / audit | `brokerage_key`, `created_by_user_id`, `updated_by_user_id`, `created_at`, `updated_at` |
| Identity | `first_name`, `last_name`, `preferred_name`, `email`, `phone_e164`, `company` |
| Relationship | `assigned_agent_user_id`, `source`, `tags`, `notes`, `last_contact_at`, `next_follow_up_at` |
| **Mixed** | **`stage`** |

Every column is honest except `stage`, which is the subject of this review.

### 1.2 `contact_opportunities` — present, and nearly inert

```
id, contact_id, kind, status, area,
budget_min_cents, budget_max_cents, timeframe, notes,
transaction_id, created_at, updated_at
```

What the repository actually does with it:

| Capability | Reality |
|---|---|
| Created | **Only** inside `createContact` (max 10 per contact), from the quick-create dialog's `intent` → `kind` mapping in `lib/data/adapters/leads.ts:144` |
| Read | `bundle()` in `lib/contacts/service.ts:108` |
| Displayed | **Never directly.** Flattened by `toLead` into one `intent` word, plus `budget` and `neighborhood` taken from a single "primary" opportunity |
| Searched | Only by `area` substring, inside the contact list filter (`service.ts:141`). Not in unified Search |
| Updated | **Never.** There is no update path anywhere in the repository |
| `status` after insert | **Never written.** `won`, `lost` and `dormant` are dead enum values; every row is `open` forever |
| `transaction_id` | **Never populated** |
| Metrics | Counted by nothing |
| AI | Not read directly; reachable only as the flattened `intent` on `get_contact` |
| Routes | None. There is no opportunity endpoint |

### 1.3 The three links that exist and are never written

This is the central finding of the audit. FortMark already has the skeleton of
the correct model, and **none of its three joints is connected**:

| Link | Column | Written? |
|---|---|---|
| Activity → Opportunity | `contact_activities.opportunity_id` | Accepted by `activityInputSchema`, offered by no UI |
| Opportunity → Transaction | `contact_opportunities.transaction_id` | Never |
| Transaction party → Contact | `transaction_parties.contact_id` | **Never** — `createTransaction` omits it entirely |

So Contact ↔ Transaction is currently unlinked **in both directions**. Nothing
in the database knows that a closed deal belonged to a person in the CRM.

### 1.4 Adjacent gap, noted but out of scope

There is no contact update path at all. The only contact mutations are
`createContact`, `changeStage` and `logActivity` — an email or phone number
cannot be corrected after creation. Unrelated to this review, worth a ticket.

---

## 2. `contacts.stage`, stage by stage

Eleven values. The column that is doing too much.

| Persisted | Label | What it actually describes | Honest level |
|---|---|---|---|
| `lead` | Lead | Nobody has qualified anything yet | Contact-ish |
| `contacted` | Contacted | We have spoken to this person | **Contact** |
| `qualified` | Qualified | Qualified *for what?* — capacity against an objective | **Opportunity** |
| `appointment` | Appointment | An appointment about a specific objective | **Opportunity** |
| `representation` | Representation | An agreement signed for one side of one objective | **Opportunity** |
| `active_client` | Active client | We are currently working for them | Rollup of opportunities |
| `under_contract` | Under contract | **A deal is under contract** | **Transaction** |
| `closed` | Closed | **A deal closed** | **Transaction** |
| `past_client` | Past client | We worked for them before | **Contact** |
| `lost` | Lost | An objective ended without success | **Opportunity** |
| `archived` | Archived | A record state | **Contact** |

**Truly Contact-level: `contacted`, `past_client`, `archived`** — three of
eleven.

**Opportunity-level, stored on Contact because Opportunity was never
implemented: `qualified`, `appointment`, `representation`, `lost`.**

**Transaction-level, leaked two layers up: `under_contract`, `closed`.**

`active_client` is a rollup — a true statement about a person that is only
derivable from their objectives.

### 2.1 The integrity hazard already present

`under_contract` and `closed` duplicate transaction stages, and **nothing
reconciles them**. Closing a transaction does not touch the contact. A contact
can sit at `under_contract` while every one of their deals is closed or fell
through, indefinitely, and `activeClients` will keep counting them. This is not
a future risk; it is live today, and it is the clearest evidence that the column
is modelling the wrong thing.

### 2.2 What the flattening costs

`toLead` reduces N opportunities to:

- `intent` — one of buy / sell / both / lease / invest / other
- `budget` and `neighborhood` — from the **most recent open** opportunity only

A contact with a Brickell condo sale and a Fort Lauderdale investment search
reads as `both`, with one budget and one area — and the other objective is
invisible. The drawer shows `Intent` as a single fact; the comment in
`lib/contacts/domain.ts` claiming the drawer shows the opportunities themselves
is **not true of the shipped UI**.

---

## 3. Domain definitions

> **A Contact is a person or organisation FortMark has a relationship with —
> everything true about them regardless of what they are currently trying to
> do.**

> **An Opportunity is one specific real-estate objective for one contact, with
> its own pipeline, its own outcome and its own accountable agent. It is the
> unit of business FortMark actually works.**

> **A Transaction is an executable deal — created once an objective has an
> identified property and terms in motion — with its own lifecycle, money and
> deadlines.**

Test: *where does `budget_max_cents` belong?* A person does not have a budget;
an objective does. Opportunity. *Where does `email` belong?* The person has it
regardless of objective. Contact. *Where does `closing_date` belong?* Only a
deal has one. Transaction.

---

## 4. Ownership matrix

| Field | Today | Target |
|---|---|---|
| name, preferred name, email, phone, company | Contact | **Contact** |
| `assigned_agent_user_id` | Contact | **Both** — Contact keeps the relationship owner; Opportunity gets its own accountable agent (§4.1) |
| `source` | Contact | **Both** — see §9 |
| `tags`, `notes` | Contact | **Contact** |
| `last_contact_at` | Contact | **Contact** |
| `next_follow_up_at` | Contact | **Both** — see §8 |
| `stage` | Contact | **Split** — see §6 |
| intent / side | Derived from opportunity `kind` | **Opportunity** (`side`) |
| residential vs commercial | Baked into `kind` | **Opportunity** (`asset_class`) |
| `area`, `budget_min/max_cents`, `timeframe` | Opportunity | **Opportunity** |
| subject property | Nowhere | **Opportunity** (sell / lease-out side) |
| representation signed / expires | Nowhere (a contact *stage*) | **Opportunity** |
| pipeline stage | Contact `stage` | **Opportunity `stage`** |
| outcome | Contact `stage` (`lost`, `closed`) | **Opportunity `status`** |
| price, commission, deadlines, closing | Transaction | **Transaction** |

### 4.1 Assignment

Contact keeps the relationship owner. Opportunity needs its own
`assigned_agent_user_id` for two reasons: a commercial specialist may work one
objective for a client another agent owns, and — decisively — `visibleTo()`
requires an owner column **on the table being queried**.

---

## 5. Opportunity model

### 5.1 `kind` is already an exploding enum

Ten values today: `buyer, seller, landlord, tenant, investor,
commercial_buyer, commercial_seller, commercial_tenant, commercial_landlord,
referral_source`. It multiplies **role × asset class** in one column. Adding
land or industrial doubles it again.

**Recommendation — decompose into two composable dimensions:**

- `side`: `buyer | seller | tenant | landlord`
- `asset_class`: `residential | commercial`

Eight combinations cover nine of the ten current values, and a new asset class
costs one enum value instead of four.

**`investor` is not a side.** It is `side=buyer` with an investment purpose.
Represent it initially through the opportunity's title and notes; promote it to
a `purpose` dimension only when a screen or a metric actually needs it.

**`referral_source` is not an Opportunity at all.** It has no pipeline, no
close and no transaction, and counting it inflates every pipeline number.
Referral belongs on the Contact (a future `referred_by_contact_id`).

### 5.2 Stage and status are both needed

One field cannot answer both "where is this in the pipeline" and "how did it
end". The current column answers only the second, which is why it is never
written — there is nothing to move it *through*.

**Stage** — where the objective is while it is open. Four values; each one
changes what work happens next, which is the test for existing at all:

| Stage | Meaning | Next action it implies |
|---|---|---|
| `new` | Captured, not yet qualified | Qualify it |
| `qualified` | Objective, timeframe and capacity understood | Win the representation |
| `representation` | Agreement signed for this objective | Begin the search / prepare the listing |
| `active` | Actively worked — searching, listed, marketing | Produce an offer |

Deliberately **not** stages: `appointment` (an activity, not a state — it
belongs in the activity stream), `under_offer` and anything past it (that is
the Transaction's lifecycle, §7), and `in_transaction` (fully derivable from a
linked non-terminal transaction, so storing it invents a second truth).

**Status** — the outcome dimension, orthogonal to stage:

| Status | Meaning |
|---|---|
| `open` | Being worked. Stage is meaningful |
| `won` | **A linked transaction reached `closed`** |
| `lost` | Ended without achieving the objective |
| `dormant` | Temporarily inactive and explicitly resumable |

### 5.3 Won / lost / dormant semantics

**`won` means the objective was achieved — a linked transaction closed.** It
does **not** mean "converted to a transaction". If conversion meant winning,
a deal that fell through would leave a won opportunity and every conversion
number would be a lie. Conversion to a transaction is a separate, useful
measurement (§10) and must stay separate.

**`lost`** needs a reason, because the reasons are operationally different and
some occur *after* a transaction exists. One small enum:
`chose_other_agent | no_longer_pursuing | not_qualified | transaction_failed |
unresponsive | other`.

**`dormant` must not become the drawer everything is swept into.** Rule:
*dormant requires a revisit date.* An opportunity with no date to come back to
is not dormant, it is lost. That single constraint is what keeps the value
meaningful. `dormant → open` on the revisit; `dormant → lost` when the revisit
confirms it is over.

Terminal: `won` and `lost` are terminal for the objective; `dormant` is not.
The Contact survives all three (§11).

---

## 6. `contacts.stage` — split, then derive

Of the four options, neither "keep" nor "deprecate" is right, and "derive" is
only half the answer.

**Recommendation: split it into a small Contact-level `relationship` field,
and derive that field's value from opportunities — except `archived`, which
stays explicit.**

| Value | Meaning | Derived from |
|---|---|---|
| `prospect` | Known, nothing won yet | No won opportunity |
| `client` | Currently worked for | ≥1 open opportunity at `representation` or `active`, or a live linked transaction |
| `past_client` | Worked for before, nothing open | ≥1 won opportunity, none open |
| `archived` | Record deliberately set aside | **Explicit only — never derived** (§11) |

The other seven values move to Opportunity or Transaction, where §2 says they
belong.

### 6.1 Do not manufacture a synthetic global stage

Jane with one won buyer objective, one active seller objective and one dormant
investor objective **cannot honestly be one word.** The UI should not try:

```
Jane Smith · Client
Active opportunities 2 · Past transactions 1 · Dormant 1
```

The relationship word answers "what is this person to us". The counts answer
"what is going on". Compressing three objectives into one badge to satisfy a
component that expects a badge would be the same mistake this review exists to
correct.

---

## 7. Transaction handoff

**A Transaction is created when an identified property and terms enter
negotiation — an offer made or received.** Not at representation.

Before there is a property there is no price, no deadlines and no closing date:
nothing a transaction row can hold honestly, and a row full of nulls waiting to
become real is how a pipeline ends up duplicated in two tables.

FortMark's transaction lifecycle already starts at `opportunity` → `offer`, so
the deal's own early stages are modelled where they belong. The Opportunity
does not need a negotiating stage; it stays `active` and the Transaction
carries the deal.

| Event | Effect |
|---|---|
| Representation signed | Opportunity → `representation`. **No transaction** |
| Offer out or received on an identified property | **Transaction created and linked.** Opportunity stays `active`, status `open` |
| Transaction reaches `closed` | Opportunity → status `won`, `closed_at` stamped |
| Transaction cancelled / withdrawn / fell through | Opportunity stays `open` (another deal may follow) or is set `lost` with `transaction_failed` — **a human decides**; this must never be automatic |

Creation is human-initiated and pre-filled, never automatic (§14.5).

---

## 8. Cardinality

### Contact ↔ Opportunity — **1 → N**

The whole point. `primary_contact_id` on the opportunity.

**Multiple contacts per opportunity: defer, but do not foreclose.** Spouses,
LLC signatories and co-buyers are real, but they bite at *signature* time, and
`transaction_parties` already solves multi-party at the transaction level.
Naming the column `primary_contact_id` now means an `opportunity_contacts`
join table can be added later without renaming anything. Single ownership is
sufficient today.

### Opportunity ↔ Transaction — **1 → N**

An investor buying three units under one mandate is **one objective and three
deals**. A seller with two parcels likewise. A single `transaction_id` column
on the opportunity cannot express this.

**The fix needs no join table: invert the foreign key.** Move the link to
`transactions.opportunity_id` — the N side holds the FK, which is the ordinary
shape for a one-to-many and is how `transaction_parties` and
`transaction_deadlines` already point at their transaction.

---

## 9. Source — both, and they answer different questions

| | Question | Example |
|---|---|---|
| `contacts.source` | How did we first meet this person? | Zillow, 2025 |
| `contact_opportunities.source` | Where did **this piece of business** come from? | Past-client relationship, 2027 |

Both are needed and neither substitutes for the other. Contact source is a
permanent acquisition fact and should never be rewritten by a later objective;
opportunity source is the number marketing attribution actually wants.

---

## 10. Metrics

### 10.1 What each current metric should become

| Metric today | Source today | Target |
|---|---|---|
| `activeClients` | Contacts in `ACTIVE_CLIENT_STAGES` | **Stays a Contact number**, derived: people with ≥1 open opportunity at `representation`/`active` |
| `lifecycle` histogram | Count of contacts by stage | **Moves wholly to Opportunity.** A pipeline chart counts objectives |
| `newLeadsThisMonth` | `contacts.created_at` | **Splits**: `newContactsThisMonth` (people) and `newOpportunitiesThisMonth` (business). The business number is the second |
| `followUpsDue` | `contacts.next_follow_up_at` + open pipeline | **Union** of contact and opportunity follow-ups, labelled by what each is about |
| `newLeadsBySource` | `contacts.source` | **Opportunity source** for attribution; contact source stays for "how we meet people" |

### 10.2 Opportunity metrics the model would support honestly

Open opportunities; by stage; by side and asset class; by agent; by source.
Representation conversion (`qualified` → `representation`). Opportunity →
transaction conversion. Won/lost rate, with `lost_reason` breakdown. Average
time in stage.

### 10.3 What cannot be reported

**No historical funnel.** Opportunities have never been worked — every row is
`open`, no status ever changed, no transaction was ever linked. Any conversion
rate computed over existing data would be fabricated. Funnel reporting begins
accumulating the day the lifecycle ships and not one day earlier. This must be
stated on any report that shows it.

---

## 11. Contact survives everything

When an objective ends, the Contact remains — unchanged in identity. A past
opportunity contributes history (what we did, what it became, what closed), not
a terminal state on the person.

**Archiving is independent.** A Contact is archived because the *record* should
be set aside — duplicate, wrong number, asked not to be contacted. It must
never follow from an opportunity ending. That coupling is one of the clearest
reasons the current global stage needs replacing: today, losing one objective
and retiring a person are values in the same column.

---

## 12. Why B, not A

The concept is right and the table exists, but implementing a service on the
current schema would be building on a base that cannot express the domain:

1. **No `stage`.** A pipeline cannot run on `open/won/lost/dormant`. This is
   why status has never been written: there is nothing to move it through.
2. **No `brokerage_key` and no `assigned_agent_user_id`.** `visibleTo(actor)`
   filters on a tenant column *and* an owner column **on the table being
   queried** (`lib/contacts/service.ts:79`). An opportunity can currently only
   be authorized by joining through its contact. Every other domain table in
   FortMark carries its own tenancy. This is an authorization-shaped gap and it
   must close before anything reads opportunities directly.
3. **`kind` conflates role and asset class** into an enum that grows
   multiplicatively.
4. **`transaction_id` is singular** and cannot express one mandate producing
   several deals.
5. **No `title`** — Search and AI need a stable display identity.
6. **No opportunity `source`**, no `closed_at`, no `lost_reason`.

None of this is a rewrite. It is one additive migration plus one inverted
foreign key, done **before** any surface depends on the shape — which is
exactly the difference between B and A.

---

## 13. Proposed schema

Additive to the existing table. Following repository conventions: cents as
`bigint`, tenancy as `brokerage_key`, enums as `pgEnum`.

```
contact_opportunities
  id                          uuid pk
  brokerage_key               text not null          -- NEW, tenancy
  primary_contact_id          uuid not null -> contacts.id  -- RENAMED from contact_id
  assigned_agent_user_id      uuid not null -> dashboard_users.id  -- NEW
  side                        enum(buyer, seller, tenant, landlord)      -- NEW, from kind
  asset_class                 enum(residential, commercial)              -- NEW, from kind
  stage                       enum(new, qualified, representation, active)  -- NEW
  status                      enum(open, won, lost, dormant) default open
  lost_reason                 enum(...) null                             -- NEW
  title                       text null                                  -- NEW, §14.7
  source                      contact_source null                        -- NEW, §9
  area                        text null
  budget_min_cents            bigint null
  budget_max_cents            bigint null
  timeframe                   text null
  notes                       text null
  closed_at                   timestamptz null                           -- NEW
  created_by_user_id          uuid null                                  -- NEW
  updated_by_user_id          uuid null                                  -- NEW
  created_at, updated_at      timestamptz

transactions
  opportunity_id              uuid null -> contact_opportunities.id      -- NEW, replaces
                                                                        -- contact_opportunities.transaction_id
```

Deliberately **not** included: a `criteria` JSON column. Beds, baths, square
feet and use type earn structured columns when a screen needs them; an
open-ended JSON blob added in advance becomes the place fields go to avoid a
migration, and then nothing can query them.

Deferred until needed, and unblocked by the naming above:
`representation_signed_at` / `representation_expires_at` (Opportunity owns
representation — it is per objective and per side, never global to a person),
`subject_property_address` for the sell and lease-out sides,
`next_follow_up_at`, and an `opportunity_contacts` join table.

### 13.1 Indexes

`(brokerage_key, stage)`, `(brokerage_key, status)`,
`assigned_agent_user_id`, `primary_contact_id`, and on transactions,
`opportunity_id`.

### 13.2 Authorization

Reuse the existing model exactly — `visibleTo(actor)` over the opportunity's
own `brokerage_key` and `assigned_agent_user_id`, `canSee` / `canWrite` /
`canCreateFor`, `resolveActor`. Agent sees their own; broker and admin see the
brokerage; cross-brokerage never. **No second authorization subsystem.**

### 13.3 History

Recommend **`opportunity_events`**, mirroring `transaction_events`: stage and
status changes are domain history, and Transactions already establish that
pattern. `contact_activities` stays the *human touch* log (calls, emails,
showings, notes) and keeps its existing optional `opportunity_id` so a touch
can be attributed to an objective.

Two streams, cleanly divided — domain history per domain, one human activity
stream across all three — rather than three parallel activity tables.

---

## 14. Surfaces

### 14.1 Follow-up hierarchy

Both levels, and they are genuinely different: *"check in with Jane"* is not
*"follow up on the Brickell listing"*.

- **Contact `next_follow_up_at` stays** as the relationship reminder.
  **F2-B remains valid and unchanged** — it schedules exactly this.
- Opportunity gains its own follow-up later, additively.
- Home unions both, labelled by subject.

### 14.2 Search

Opportunity should become a first-class searchable entity — **once it has a
title** (§14.7), not before.

```
Brickell Condo Sale               Jane Smith · Seller · Residential · Active
Jane Smith                        Client · 2 active opportunities
```

### 14.3 AI reading model

Selective context, one hop at a time — never a history dump:

```
search_entities → get_contact      relationship + opportunity SUMMARY
                → get_opportunity  one objective, with its linked transactions
                → get_transaction  one deal
```

`get_contact` should return counts and one-line summaries (title, side, stage,
status) — enough to answer "what is going on with Jane" and to choose the next
call. Full objective detail requires an explicit `get_opportunity`. Future
reads: `list_opportunities` (by contact, stage, status, agent) and
`get_opportunity`.

### 14.4 AI action roadmap

A future `prepare_opportunity_stage_change` sits at **the same risk tier as
F2-C** and below transaction-stage: reversible, no money moved, no date
stamped, no reporting rewritten.

**Excluded from any first scope: `won` and `lost`.** `won` asserts that a
transaction closed — money and monthly production — and `lost` is a judgement
about a person's intent that a model should not infer from a thread. Same
reasoning that excluded `archived` from F2-C and the terminal stages from
transactions.

### 14.5 Transaction creation from an Opportunity

Yes — optional origination, pre-filling contact, agent, side and property, with
the human confirming. Never automatic, and the Opportunity link is set at
creation so `won` can later mean something.

### 14.6 Contact detail and the pipeline page

Contact drawer: identity and relationship in the header, then **Active
opportunities**, **Past opportunities**, **Transactions**, **Activity**,
**Follow-up** — replacing a single stage selector that currently controls the
person's entire meaning.

The Leads page is already an opportunity pipeline wearing a contact's clothes:
it lists people, and the column it sorts them by is an objective's stage. It
should become **two views** — *Pipeline* (opportunities, the primary sales
view) and *Contacts* (people, a directory).

### 14.7 Titles and duplicates

**Both explicit and derived.** A nullable `title` a person can set, with a
derived fallback — `{Side} · {area or asset class}` → "Seller · Brickell".
Search and AI need a stable display identity; humans need to be able to name
one "Brickell Condo Sale".

Duplicates: **warn, never block.** Two open opportunities with the same side
and asset class for one contact is worth flagging — and is also exactly what
two buyer searches in different markets look like. Titles and areas are what
make them distinguishable.

### 14.8 Terminology

UI and code both say **Opportunity**. "Deals" collides with Transaction,
"Clients" collides with the relationship field, "Active Needs" is vague.
Opportunity is standard brokerage vocabulary and is what a broker says out
loud. No internal/external split — renaming code for marketing is how the two
drift apart.

---

## 15. Person vs company, and teams

`contacts.company` is a text field on a person record; there is no company
entity. An LLC buyer today is a Contact whose name is the LLC. The Opportunity
model works either way, because it points at whatever the Contact is.

**Limitation to record:** "Jane is the authorised signer for Acme LLC" cannot
be expressed. This bites at signature and transaction-party level, not at
objective level, and `transaction_parties` is where it should eventually be
solved. Do not build entity modelling for this review.

**Teams:** the current model is `assigned_agent_user_id` + `brokerage_key` +
role. There is no team table. Opportunity should carry an **agent**, not a
team — a team column can be added later without changing ownership semantics,
whereas starting with a team would make individual accountability the
special case.

---

## 16. Migration

**Not performed. Designed only.**

| Current stage | Contact relationship | Create opportunity? | Opportunity stage / status | Ambiguous? |
|---|---|---|---|---|
| `lead` | `prospect` | Only if a row already exists | `new` / `open` | — |
| `contacted` | `prospect` | Only if a row already exists | `new` / `open` | — |
| `qualified` | `prospect` | Yes, if a row exists | `qualified` / `open` | **Side unknown when no row exists → review** |
| `appointment` | `prospect` | Yes, if a row exists | `qualified` / `open` | **No target stage — `appointment` is an activity → review** |
| `representation` | `client` | Yes | `representation` / `open` | — |
| `active_client` | `client` | Yes | `active` / `open` | — |
| `under_contract` | `client` | Yes | `active` / `open` | **Which transaction? None is linked → review** |
| `closed` | `past_client` | Yes | `active` / `won` | **`won` requires a closed transaction that is not linked → review** |
| `past_client` | `past_client` | **No** | — | Cannot invent a historical objective |
| `lost` | `prospect` | Yes, if a row exists | — / `lost` | `lost_reason` unknowable → `other` |
| `archived` | `archived` | **No** | — | — |

**Four stages require human review and cannot be migrated automatically.** The
reason is the same in each case: `transaction_parties.contact_id` was never
written, so the database does not know which deal belonged to which person.
Nothing may guess.

**A contact with no opportunity row gets no opportunity.** Inventing one would
fabricate intent, and the resulting funnel would report business that never
existed.

### 16.1 Safety sequence

Additive schema → backfill new columns from `kind` (`side` + `asset_class`,
mechanical and lossless) → **validation report** that reconciles before/after
(`activeClients` must be identical; every contact stage must account for its
population) → dual-read behind a flag → cut over one surface at a time →
retire `contacts.stage` last.

Non-negotiable: no duplicate clients, no invented opportunities, no fabricated
intent, no silent reporting change, and the old stage value preserved in
history so a migration decision can be audited.

### 16.2 Ordering

Schema → service → **transaction linkage** → Contact detail → pipeline UI →
metrics → Search → AI → contact-stage retirement.

Transaction linkage is deliberately third, not fifth: `won` is meaningless
until an opportunity can point at a closed deal, and every metric downstream
depends on `won` being true.

---

## 17. F2-B and F2-C during migration

**Neither changes now.**

**F2-B — validated, keep.** It schedules a relationship-level follow-up, which
is exactly what stays at Contact level. Unaffected by everything above.

**F2-C — restrict, then retire.** As `contacts.stage` collapses into a derived
`relationship`, the set of stages a human (or the AI) may set directly shrinks
to `archived`, which F2-C already excludes. Its proposable set therefore
becomes empty, which is the honest outcome: **F2-C retires in the same release
that ships `prepare_opportunity_stage_change`.** Never two writers for one
concept, and never a window where the AI writes a column that is also being
derived.

Until then F2-C keeps operating on `contacts.stage` unchanged, because for now
that column is still the source of truth.

---

## 18. Phased roadmap

| Phase | Scope |
|---|---|
| **O1** | Opportunity schema evolution + service + read-only display in the contact drawer |
| **O2** | Opportunity routes and human CRUD |
| **O3** | Transaction linkage (`transactions.opportunity_id`, party → contact) |
| **O4** | Opportunity pipeline UI; Leads page becomes Pipeline + Contacts |
| **O5** | Contact `relationship` derivation; contact detail restructure |
| **O6** | Metrics migration + validation report |
| **O7** | Unified Search: Opportunity as a first-class entity |
| **O8** | AI reads: `list_opportunities`, `get_opportunity`, `get_contact` summary |
| **O9** | Controlled action: `prepare_opportunity_stage_change` |
| **O10** | Retire `contacts.stage`; retire F2-C |

### 18.1 First implementation slice — **O1 only**

**Opportunity schema evolution + service + read-only display in the contact
drawer.**

- Additive migration per §13, including the inverted `transactions.opportunity_id`
- `lib/opportunities/` — stages module, domain, service with `visibleTo`,
  `canSee`/`canWrite`, and a `planStageChange`/`commitStageChange` writer
  following the pattern the contact and transaction domains now share
- Backfill `side` + `asset_class` from `kind`
- The contact drawer shows the real opportunity list instead of the flattened
  `intent` word — **read-only**

Why this one: every later phase depends on the schema, the authorization gap
(§12.2) must close before anything reads opportunities directly, and surfacing
the existing rows read-only delivers visible honesty immediately without
letting the UI outrun the model.

**Do not start it.**

---

## 19. Open decisions for the owner

1. Is `purpose` (primary residence / second home / investment) a third
   dimension, or does `title` carry it? — §5.1
2. Does a lease renewal create a new Opportunity or reopen one? — affects
   whether `won` is terminal
3. Should `relationship` be stored-and-refreshed or computed per read? Start
   computed; materialise only if a query proves it necessary — §6
4. Who resolves the four ambiguous migration classes, and against what
   evidence? — §16
