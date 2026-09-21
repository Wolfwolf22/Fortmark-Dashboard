# Unified search

> A user should be able to find anything they are authorized to work with in
> FortMark from one place.

## Architecture

```
⌘K command palette
  └── lib/data/adapters/search.ts        POST, AbortController, no sample path
        └── POST /api/search             requireCaller() → verified Clerk session
              └── lib/search/service.ts  providers in parallel, independent failure
                    ├── lib/contacts/search.ts      ← visibleTo() + contacts
                    ├── lib/transactions/search.ts  ← visibleTo() + parties + contact link
                    └── lib/mls/service.ts          ← Bridge, when configured
```

`lib/search/` imports no React, no Next route handler and no component. That is
deliberate: Phase F's AI tools will call the same providers to work out which
client "Jane" refers to, and must be able to without importing a palette.

## Searchable entities

| Entity | State | Matches on |
|---|---|---|
| Contacts | **Real** | name (first, last, preferred, full), company, email, phone |
| Transactions | **Real** | address, city, MLS number, party name, party/linked-contact email and phone |
| Listings | Provider built; `not_configured` until Bridge works | address, MLS number |
| Team | **Intentionally omitted** — `not_configured` | — |

Team search is declared in the contract and unbuilt: there is no canonical
per-agent destination to navigate to, and a result that goes nowhere is worse
than no result. It slots in when a team route exists.

## Matching

The query is classified once (`lib/search/query.ts`) and the providers are told
what shape it is. This is pattern recognition on obvious forms — **not**
natural-language understanding, embeddings or an LLM.

| Typed | Shape | Effect |
|---|---|---|
| `jane@example.com` | email | exact on contact email / party email |
| `(954) 555-0100` | phone | digits become an E.164 suffix match |
| `A12008414` | mls | exact on `mls_number` |
| a UUID | uuid | exact on the record id |
| `2451 Brickell` | text | prefix, else containment |

`%` and `_` are escaped, so a query of wildcards cannot ask for the whole table.
Case and whitespace are normalised. Stored data is never mutated for search.

## Ranking

Two tables and a tie-break, in `lib/search/rank.ts`. No score.

1. **Match strength** — `exact_id` → `exact_email` → `exact_phone` → `exact_mls`
   → `prefix` → `partial`. Nobody types a whole email address by accident.
2. **Entity** — contact → transaction → listing → agent. People first: the
   person is the canonical record the rest of the system hangs off.
3. **Title, then id.** Fully deterministic; identical requests never reorder.

A single exact match is promoted above the groups as "Top result". Two equally
exact matches promote neither — if both match, neither is *the* answer.

## Authorization

Every provider query carries the same `visibleTo()` predicate as its list
screen. Nothing is fetched and then filtered, so an unauthorized row is never
loaded. Scope comes from the verified session; the request body carries one
field and it is text.

Verified against Preview Neon with a deliberate fixture (two agents, a broker,
a second brokerage):

| Query | Agent A sees | Broker sees |
|---|---|---|
| `jane` (3 Janes exist) | 1 — her own | 2 — the brokerage's |
| other-brokerage Jane | never | never |
| `brickell` (2 deals exist) | 1 | 1 |
| other-brokerage Brickell | never | never |

## Privacy

Results carry **identification and navigation only**: title, what kind of record
it is and where it stands, one disambiguating detail (email, phone or a closing
date), and a link. Never notes, tags, prices, commission, budgets, documents or
audit payloads. The `SearchHit` type has no field for a record's contents.

### Why POST for a read

Every other read here is a GET. This one is not.

A search string is a client's name, their phone number, the address of the
property they are buying. A GET puts that in the request line, and the request
line is what the platform writes to its access logs — so ordinary use of the
palette would quietly accumulate a log of the brokerage's clients, readable by
anyone with project access and retained on someone else's schedule. A POST body
is not logged that way. The cost is HTTP caching, which a per-user authorized
search must refuse anyway (`private, no-store`).

Nothing on the search path calls `console.*`, so queries do not reach the
application log either.

**Known gap:** `/api/contacts?q=` — used by the leads screen search box — has
the same exposure and was not changed in E2. It should move to the same
treatment.

## Degradation

Providers run in parallel and fail independently. A broken MLS never deletes the
contacts a user was typing towards.

| Provider state | Palette says |
|---|---|
| `available`, no hits | "No contacts and transactions match …" |
| `not_configured` | "MLS search is not connected." |
| `unavailable` | "Contacts search is temporarily unavailable." |
| request failed | "Search is unavailable right now." |

"We searched and found nothing" and "we could not search" never read the same
way. A user told "no results" when the MLS was merely disconnected would
conclude the property does not exist.

## Limits

| Bound | Value | Why |
|---|---|---|
| Per provider | 5 (+1 probe for `truncated`) | the palette is a finder, not a report |
| Minimum query | 2 characters | below it, providers are not woken |
| Minimum for MLS | 3 characters | remote and billable per call |
| Maximum query | 120 characters | refused with 400, never truncated |

## Indexes — and why none were added

Search filters by brokerage (and by agent for non-privileged callers) *before*
any text matching, and those predicates are served by the existing
`transactions_agent_idx` / `contacts_agent_idx` and the brokerage columns. Text
matching then runs over one brokerage's rows, which at FortMark's scale is a
few thousand at most.

No migration was added. Adding `pg_trgm` or expression indexes now would be
speculative. Revisit when a single brokerage passes roughly 50k contacts or when
a query plan shows text matching, rather than the tenancy predicate, dominating.

## Deep links

| Entity | Destination |
|---|---|
| Contact | `/leads?open=<id>` |
| Transaction | `/transactions?open=<id>` |
| Listing | `/listings/<id>` |

These are the drawer deep links the screens already use, so a result lands the
user on the entity itself and the URL is reproducible.

## Commands vs results

The palette is a launcher and a finder. Quick actions (Add a contact, Create a
transaction) and navigation are commands: never sent to a database, always
available, and still working when every provider is down.
