# FortMark Dashboard — Live MLS Certification (Core V1 Listings)

**Date:** 2026-09-23 · **Environment:** Preview only · **Certified revision:** `14dd7d4`
(branch `claude/dashboard-status-yir55p`) · **Provider:** Bridge Interactive (RESO Web API) ·
**Dataset:** `miamire` (IDX feed)

**Result: CORE V1 LISTINGS LIVE VERIFIED on Preview.**

Production was not touched. It still serves `b4c04d0` with `listings: not_configured`,
and holds no Bridge credential.

---

## 1. Configuration and credential

| Item | State |
|---|---|
| `BRIDGE_API_TOKEN` (Preview, Sensitive) | present; **accepted** by Bridge (first live request: 200). The value was never read, printed, hashed or measured. |
| `BRIDGE_DATASET` (Preview, Sensitive) | present; dataset accepted |
| `MLS_LISTINGS_ENABLED` (Preview, Sensitive) | present; health `listings: "mls"` |
| Binding | The variables were added at 2026-09-23 01:59Z. A fresh Preview build was needed because environment variables bind at deploy time (redeploy `dpl_6Yh2MzN7GC8hh25wRtsaVUvTrny1`, then git builds). |

**Path under test:** browser → `/dashboard/api/*` (authenticated Preview certification
user) → `lib/mls` → Bridge. No separate client, no direct Bridge call, no credential in
the test harness.

**Field catalogue:** every field in `PROPERTY_FIELDS`, plus the embedded `Media`, is
accepted by `$select` (Bridge answers 400 to an unknown field; every query answered 200).

---

## 2. Search, filters, paging, sort

| Check | Live result |
|---|---|
| Fort Lauderdale, residential, active | count 2,284; every row `source: mls`, `status: active`, city correct |
| Attribution | every row carries the listing office from the feed; 19 distinct offices on one 24-row page |
| All statuses vs active (MLS-wide) | 772,327 vs 48,489; default is now Active (see §8) |
| Pagination | 3 × 24 rows, 72 distinct, identical totals; `$top` / `$skip` / `$count` server-side |
| Price 500k–750k | every row within range |
| Beds ≥ 4 | every row ≥ 4 |
| Condo / single family / townhouse (Fort Lauderdale) | 1,181 / 812 / 158; every row typed correctly |
| Land / multi-family (MLS-wide) | 6,620 / 1,350 after the fix in §8 (both were 0 before) |
| Sunrise | count > 0, city correct |
| Sort | price ascending and descending monotonic; newest-first monotonic for dated rows; DOM sort applied upstream |
| Closed status | status=closed returns only closed rows |
| Exact MLS number | exactly one row; detail resolves by ListingKey and by MLS number |
| Baths filter | not offered by the current filter design (P3; not built in this phase) |

## 3. FortMark's own listings

- **Office id `FTMK01` verified live.** The id filter (listing or co-listing office) returns 6 active listings. The name query ("FortMark, LLC") returns the same 6, but the id is authoritative.
- Every FortMark-scoped row has `isFortmark: true`.
- `/api/listings/featured` gives `fortmarkActiveCount = 6`, equal to the scoped total. The featured listing is FortMark's and is the highest-priced of the six.
- Rendered: the "MLS search / FortMark listings" switch moves between 48,489 and 6, with no stale rows. It is operable by keyboard (radiogroup, `aria-checked`).
- Empty office: covered deterministically offline (a stub with no FortMark rows gives count 0 and no featured row; Home says "No active FortMark listings").

## 4. Display compliance (IDX)

- **Not displayable:** every Property query requires `InternetEntireListingDisplayYN eq true`, and the normaliser drops any `false` record. The live feed carries no such active record today (counts are identical with and without the clause), so the rule is certified offline against the stub.
- **Withheld address:** 3 live Fort Lauderdale listings with `InternetAddressDisplayYN = false` were certified end to end.
  - On these records the feed itself nulls the street number and name, but it **still sends the parcel number**.
  - Across detail, the results list and ⌘K, the dashboard returns "Address withheld by listing broker" with no folio and no coordinates.
  - The parcel number appears in none of the browser payloads.
- **Attribution:** "Listing courtesy of <office>" on detail, taken from the feed, and the office on Home's card. Nothing is hard-coded.
- **Payload boundary:** browser responses contain only product `Listing` fields (asserted key by key). No raw RESO object reaches React.

## 5. Detail and media

- **Detail fields:** MLS #, status, price, address (when permitted), city, type, beds, baths, sqft, lot, year built, list date, DOM, remarks, agent name, office and photos. A missing value renders "—".
- **Embedded media:**
  - `miamire`'s Media resource returns `MediaURL: null`, so photos come from the embedded `Property.Media` collection.
  - All six FortMark galleries exactly match the feed's `PhotosCount` (17/43/21/20/27/24): all from CloudFront, no duplicates, in order.
  - No Media-resource request is made when the embedded collection is present.
- **No photos:** a live photo-less listing shows "The MLS has no photos for this listing". No stand-in image.
- **Image hosts served:** the app, Clerk and `dvvjkgh94f2v6.cloudfront.net` only. `remotePatterns` allowlists that exact host; optimisation settings are unchanged.
- **Deep link:** reload and back/forward on the detail URL preserve the listing.
- **Responsive:** Listings and detail at 390, 430 and 1440 px have no horizontal overflow, after the fix in §8.

## 6. Home, ⌘K, comparables

- **Home:** the "FortMark listings" card shows the live count (6) and FortMark's highest-priced active listing. The "MLS not connected" copy is gone. An MLS failure degrades only this card.
- **⌘K:** a real MLS number returns a listing hit (`href /listings/<key>`); selecting it opens the detail page. The contact and transaction providers are unaffected. A withheld-address listing's hit title is the withheld text.
- **Comparables:** CERTIFIED (advanced). A Sunrise single-family subject returned 10 closed single-family sales. They pass through the same sanitising normaliser.

## 7. Security, network, caching, logs

- **Browser → Bridge requests:** 0. All MLS traffic is server-side.
- **Bundles:**
  - Live Preview: 320 loaded scripts contain neither the Bridge host nor the token variable name.
  - Local build: 92 client chunks contain none of the Bridge host, `BRIDGE_API_TOKEN`, `BRIDGE_DATASET`, raw RESO field names or the office id.
- **Token transport:** `Authorization: Bearer` header only, never in a URL. Logs record status, resource and classification; for an upstream 400 they record Bridge's error text (at most 300 characters). They never record the token or a listing payload.
- **Caching:** every listings route answers `private, no-store`, the same as the CRM routes. There is no MLS cache, so nothing can leak across users.
- **Freshness:** the UI claims no "real-time" data. "Live" here means the current Bridge feed.
- **Access:** any allowlisted, signed-in user can search the MLS (brokerage-wide data). FortMark-owned CRM records keep their own authorisation.

## 8. Defects found live and fixed

| # | Severity | Defect | Fix |
|---|---|---|---|
| L1 | P1 | Land filter matched 0 active listings: `miamire` files land as `Land/Boat Docks` and `Commercial Land`, not the RESO `Land` | Filter and normaliser use the dataset's values (standard spelling kept) |
| L2 | P1 | Multi-family matched 0: duplexes through quadruplexes are `Residential Income` | Same |
| L3 | P2 | A record with no `ListingContractDate` was shown as "Listed" on its modification date (and sorted first) | List date is unknown and shows "—"; client sort treats it as oldest |
| L4 | P2 | MLS search defaulted to "All statuses" (~772k historic records) | Default is Active; every status is still selectable |
| L5 | P2 | The detail page overflowed to 512 px at a 390 px viewport (thumbnail strip) | Single mobile grid column plus `min-w-0` |

There were no P0 findings: no private-address leak, no token exposure and no fake-listing mixing.

## 9. Performance (single observations, Preview, iad1)

| Request | Time | Browser payload |
|---|---|---|
| Search (12 rows) | 0.4–0.9 s | 18 KB |
| Search (48 rows) | 0.6 s | 80 KB |
| Filtered search | 0.43–0.57 s | — |
| FortMark scope | 0.39 s | — |
| Detail (24 photos) | 0.33 s | 3.4 KB |
| Featured + count | 0.33 s | 1.6 KB |
| Comparables | 0.43 s | — |

Each screen makes one Bridge request. There is no per-card media request (media is
embedded, and results are trimmed to one thumbnail), no N+1 and no serial chain.

## 10. Known limitations

- There is no baths filter in the current design (P3).
- Rows with no list date sort first on "newest" (Bridge orders nulls first); they show "—".
- The non-displayable rule has no live test case because the feed currently omits such records; it is certified offline.
- Office phone is available from the MLS (`ListOfficePhone`) and the office URL is null in the feed. Neither is shown yet: brokerage identity is its own next phase. The brokerage licence number and office address belong in FortMark-owned data, because the MLS is not their source of record.
- Settings-hydration flakiness in automation (known ISS-09 class) occasionally needs a re-run; no product defect.

## 11. Verification run

- **Offline:**
  - `npm test`: all suites green (MLS 218, profile 1212, team 30, search 64, metrics 99, mock-leak 61, …).
  - `npm run test:migrate`: 19/19. Typecheck clean. Local build clean.
- **Live:**
  - `e2e/mls-live.spec.ts`: 15/15.
  - `e2e/zero-data-sweep.spec.ts`: 8/8. It now allows exactly FortMark's featured price on Home, checked against the API, and MLS prices on Listings; every other figure stays forbidden.
- **Cleanup:** the certification identity's Preview rows (1 user, profile, image, 19 audit events) were removed. Preview domain tables are back to zero. No MLS data was altered.
