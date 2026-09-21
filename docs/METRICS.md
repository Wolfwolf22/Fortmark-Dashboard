# Home metrics — the audit, and what replaced it

## The rule

> If FortMark cannot prove a number, FortMark does not display that number as fact.

`0` means the source answered and the answer was zero. Anything else — not
connected, unreachable, not yours to see — says so in words. The two are never
rendered the same way.

## The audit (before Release E1)

Every tile on Home, what it claimed, and where the claim came from.

| Widget | Claimed | Source before | Fabricated? | Correct source | Available? |
|---|---|---|---|---|---|
| Identity card | Name, licence, NRDS | `professional_profiles` + Clerk session | No | — | Yes |
| Featured listing | A live listing | listings adapter, sample when Bridge absent | Yes, on Home | Bridge MLS | **No** — credential rejected upstream |
| Under contract | Count **vs a goal** | generator | Yes, incl. an invented goal | transaction lifecycle | Yes |
| Closed | Count **vs a goal** | generator | Yes, incl. an invented goal | `closed_date` | Yes |
| Pipeline value | Open contract dollars | generator | Yes | `contract_price_cents` | Yes |
| Closed volume | Dollars + prior period + sparkline | generator | Yes | closed deals by month | Yes |
| Projected commission | GCI series | generator | Yes | `money.ts` over real terms | Yes |
| Lead source | Donut of lead origins | generator | Yes | `contacts.source` | Yes |
| Leaderboard | Per-agent production | generator (incl. "offers made") | Yes | per-agent aggregates | Yes, privileged only |
| Market pulse | Price cuts, demand shifts | generator | Yes | a market feed | **No** — none exists |
| Compliance | Expiring agreements, missing disclosures | generator | Yes | `transaction_deadlines` | Deadlines yes; documents no |
| Transactions table | Active deals | transactions adapter | No — already real | — | Yes |

Eleven tiles; nine of them stated things about the business that were not true.

## What replaced it

```
Home (one request)
   └── GET /api/metrics            requireCaller() → verified Clerk session
         └── lib/metrics/service   per-domain availability, role-aware scope
               ├── lib/transactions/metrics   ← visibleTo() + stages.ts + money.ts
               ├── lib/contacts/metrics       ← visibleTo() + stages.ts
               └── lib/mls/service            ← Bridge $count
```

One request per screen, not one per widget: eleven independent queries were
eleven chances for the tiles to disagree with each other.

### Availability

| State | Meaning | Rendered as |
|---|---|---|
| `available` | The source answered. Zero means zero. | The number |
| `not_configured` | Nothing of the kind is connected here | "Not connected" |
| `unavailable` | Configured, but it could not be reached | "Temporarily unavailable" |
| `not_permitted` | The caller's role may not see this aggregate | "Not available for your role" |
| `no_identity` | No brokerage identity yet (profile unsynced) | "Finish setting up your profile" |

A thrown query becomes `unavailable`, never `0`. `lib/metrics/service.ts`
carries no import of any sample generator, and a test enforces that.

### Authorization

Aggregates run through the **same** `visibleTo()` predicate as the lists they
summarise — exported from each domain service for that purpose. An agent's
dashboard counts an agent's book; a broker's counts the brokerage. `scope` is
reported in the payload so the screen names whose numbers it is showing. The
leaderboard is withheld from non-privileged callers in two places: the service
returns `not_permitted`, and the query itself returns `[]`.

### Money and dates

Commission is projected by `lib/transactions/money.ts` and nowhere else —
metrics fetch a narrow projection of the integer term columns in one query and
reduce them through `projectCommission`, rather than re-deriving the arithmetic
in SQL. Counts and sums are filtered aggregates in Postgres.

All windows are computed in UTC by `lib/metrics/window.ts`, and the month a
payload measured is returned as `monthStart` so the screen states its window.
Scheduled closings and actual closings are separate fields and never merged.

### The two honest exceptions

**MLS.** Bridge is configured or it is not. Not configured → `not_configured`.
Configured and failing → `unavailable`. Never `0 active listings`, which would
assert something false about the market. Home does not feature a generated
listing either: the card shows the unavailable state until a live feed exists.

**Fixture mode.** `SAMPLE_DASHBOARD_ENABLED=1` (strict, off by default) lets
Home serve the generated brokerage for a demonstration. It applies *only* where
both real domains are `not_configured` — never where one is `unavailable`,
because standing in for a failure is exactly the silent fallback this design
exists to prevent. The payload is stamped `source: "sample"` and the screen
prints a visible label above the grid.

## Readiness probe

`GET /api/health` — unauthenticated, no records, no counts, no configuration
values. It reports which source each domain resolved to, using the same helpers
the routes call:

```json
{ "ok": true, "sources": { "transactions": "db", "contacts": "db",
                           "listings": "sample", "homeMetrics": "real-only" } }
```

It exists because "the environment variable is set" is not proof that the
running deployment resolved it. An operator must be able to ask a deployment
whether it is serving real records before signing into it.

## The Home hierarchy (product audit, post-E1)

Making the data real exposed a layout built for mocks. With generators in
place every one of eleven equal-weight cards always had something to show, so
order barely mattered. With real records, several are empty or forbidden for a
given reader — and the one module that answers "what should I do today" was
eleventh of eleven.

What changed:

| Before | After |
|---|---|
| 5 KPI cards in the first viewport | 4 figures in an editorial band, above the grid |
| "Needs attention" last | First widget |
| Recent activity tenth | Third |
| MLS: full-width "Not connected" band | Narrow integration status, last |
| Leaderboard: 8-col "not for your role" for every agent | Not rendered for agents |
| Closed count and closed volume in two cards | One card |
| Projected headline above a closed-commission chart | Projection in the band; chart is history only |
| 11 widgets | 8 |

The band is not four cards. FortMark's system is editorial — hierarchy from
weight and spacing, structure from hairline rules — so the figures sit in one
aligned field divided by rules. A figure a source cannot state renders as an em
dash with the reason beneath it, never as a zero.

Order (`lib/stores/widget-order.ts`) reads down the page as: what to act on,
what is being worked, what just happened, how the year is going, then what
belongs to someone else or another system. The four headline figures are
deliberately not reorderable widgets — a dashboard whose first numbers can be
dragged below the fold is not a brief.

`lib/metrics/home-layout.ts` holds the three decisions this forced, as pure
predicates so they are tested directly: `leaderboardVisible`, `mlsIsCompact`,
`isFirstUse`. Each hides or reshapes presentation only — no figure is invented
or suppressed, and `isFirstUse` is false when a domain is *unavailable*, so a
database outage is never mistaken for a new brokerage.

## Still fiction

- **Reports** (`getDashboardMetrics`) is still the generated series. Home no
  longer touches it; Reports is the next screen to be made real.
- **Market intelligence** has no source. The tile now carries real recent
  activity instead.
- **Document compliance** (missing disclosures, expiring agreements) returns
  when FortMark stores the documents that would prove it. Needs-attention
  currently runs on real deadlines and real follow-up dates only.
