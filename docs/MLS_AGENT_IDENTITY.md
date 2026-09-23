# Agent MLS identity

**What it answers:** who the signed-in FortMark agent is in the MLS, and therefore
which listings are theirs.

**Introduced:** Core V1, 2026-09-23 · migration `0010_flaky_toad` · Preview only.

FortMark Dashboard is FortMark-only. Every dashboard user is a FortMark user,
admitted by Clerk plus the FortMark allowlist. An agent never tells the dashboard
which brokerage, office or MLS id they belong to. They enter their own
**professional licence**, and the server resolves the rest:

```
professional licence (profile) ──► MLS Member roster ──► FortMark office check
        ──► stored MemberKey (mls_member_links) ──► My Listings / Home
```

## Feed facts (verified live in `miamire`, 2026-09-23)

| Resource | Fields used | Notes |
|---|---|---|
| `Member` | `MemberKey`, `MemberMlsId`, `OfficeMlsId`, `MemberStatus`, `MemberStateLicense` | About 50,900 active members. Licences are stored mostly **without** the DBPR prefix: only 6 active members carry `SL`/`BK`. No email, phone, address or social field is ever selected. |
| `Office` | `OfficeKey`, `OfficeMlsId`, `OfficeName`, `OfficePhone`, `OfficeStatus` | `FTMK01` is "FortMark, LLC": active, Fort Lauderdale FL, IDX participant. |
| `Property` | `ListAgentKey`, `ListAgentMlsId`, `CoListAgentKey`, `CoListAgentMlsId` (plus the office fields) | Exactly **two** agent roles per listing. This MLS has no second or third co-listing field. `ListAgentKey`/`CoListAgentKey` equal `Member.MemberKey`. |

FortMark had 3 active members and 6 active listings at the time of verification. At
least one member is the primary agent on one listing and the co-listing agent on
four, so co-listing was certified live.

## Resolution

1. **Normalise the licence:** upper-case, with spaces, dots, hyphens and slashes
   removed.
2. **Build the candidates:** `SL1234567` also looks up `1234567`, and a bare
   `1234567` also looks up `SL…` and `BK…`. These are spellings of the same number;
   a different digit never matches.
3. **Query the roster:** one `Member` request (`MemberStateLicense eq …`,
   `$top=10`), server-side only.
4. **Classify** (`lib/mls-identity/rules.ts`):

   | Roster answer | Status | My Listings |
   |---|---|---|
   | exactly one **active** member, `OfficeMlsId` = FortMark's office | `linked` | on |
   | exactly one active member, another office | `office_mismatch` (broker review) | off |
   | no active member (also: licence state not FL) | `not_found` | off |
   | more than one active member | `ambiguous` (broker review) | off |
   | the member is already linked to another dashboard user | `conflict` (broker review) | off |
   | the MLS could not be asked | `unavailable` | off |

   The browser also sees two derived states: `no_license` (nothing to resolve) and
   `stale` (the licence changed since it was resolved).
5. **Store** one row per user in `mls_member_links`: status, the licence that was
   resolved, `member_key`, `member_mls_id`, `office_mls_id`, `candidate_count`,
   `checked_at` and `linked_at`. The database enforces the status values with a CHECK
   constraint.
6. **Audit:** `mls_identity_resolved` with `{status, candidateCount}` only. The
   licence and roster fields are never recorded.

Nothing is guessed. `not_found` means **the MLS does not show it**, never "invalid
licence": a real licence can be outside this MLS, under another association, or
delayed in the feed.

## When it runs

- **After a profile or onboarding save,** only if the licence number or state
  changed (or was never resolved). The licence is saved first; resolution is
  enrichment and never fails the save.
- **The first time Profile asks** (`GET /api/profile/mls`), if the stored link is
  stale.
- **On explicit refresh:** `POST /api/profile/mls` for yourself, or `{ userId }` for
  another FortMark user (admin or broker only; the target must already be a
  dashboard user).
- **Never per page load:** My Listings and Home use the stored `member_key`.

**Licence change:** the link no longer matches the profile, so it reads `stale` and
nothing uses it. The save re-resolves immediately; an old member never follows a new
licence. **Clearing the licence** deletes the link.

## My Listings

- **Filter:** `(ListAgentKey eq K or CoListAgentKey eq K)` with the stored MemberKey,
  plus the IDX display clause. There is no name matching.
- **Role marking:** each row carries `agentRole: "primary" | "co_listing"`, shown as
  "You · Listing agent" or "You · Co-listing agent".
- **Status:** the default is Active, and other statuses are available through the
  status filter.
- **Compliance still applies:** the withheld-address sanitiser and the non-display
  filter apply exactly as elsewhere. Being the listing agent grants nothing extra.
- **Honest failure:** without a `linked` identity, `office=mine` is a **409**
  `mls_identity_not_linked` carrying the state, never "0 listings". A linked agent
  with nothing listed gets a real zero: "You have no active MLS listings."

## Scopes and defaults

| Scope | Query | Who |
|---|---|---|
| My listings | MemberKey (listing or co-listing agent) | anyone with a linked identity |
| FortMark listings | office id (`FORTMARK_MLS_OFFICE_ID`), listing or co-listing office | everyone |
| MLS search | whole MLS | everyone; independent of identity and office |

- **Listings default:** broker, admin or coordinator → FortMark; a linked agent →
  My listings; anyone else → MLS search. Explicit `?office=mine|fortmark|all` always
  wins.
- **Home card:** broker, admin or coordinator → FortMark's active book; everyone
  else → their own book. An unlinked agent sees "MLS identity not connected" with the
  reason.
- **⌘K:** stays MLS-wide.

## Boundaries

- **Access** is Clerk plus the allowlist. A roster outage only turns MLS-linked
  features off; it never locks anyone out or changes a role.
- **Accounts:** the roster never creates, admits or removes dashboard users.
- **Office mismatch:** an agent with a mismatch is never shown another office's
  listings as theirs, and FortMark's brokerage record is never switched to that
  office.
- **Browser boundary:** the browser receives only `{state, linked, officeName,
  checkedAt}`, plus `memberMlsId` for admin and broker. No member key, roster payload
  or Bridge token reaches it.

## Tests

- `npm run test:mls-identity`: 112 checks covering:
  - role display;
  - licence normalisation;
  - the classification matrix;
  - staleness;
  - roster and office queries against a stub with the live field names;
  - My Listings (primary, co-listing, exclusions, IDX, withheld address, zero);
  - scope separation;
  - system office configuration;
  - onboarding;
  - Team;
  - route decisions.
- `npm run test:migrate`: 0010 applies fresh, and the status CHECK refuses an
  unknown value.
- `e2e/agent-identity.spec.ts`: the live chain on Preview (see
  `docs/CORE_V1_COMPLETION.md` §11).
