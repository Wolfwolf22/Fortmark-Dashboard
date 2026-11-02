# Showing tours and route recommendations

Local update, 2026-11-02. Opening a showing now includes a map and itinerary
for that appointment's client, saved list and New York calendar day. Existing
feedback, editing, rescheduling and follow-up controls remain available.

## Route planning

Start with the scheduled appointments in this group. Add other properties from
the same private saved list when needed. A route can contain two to eight
properties. Choose the first property or let the route recommend it, the first-visit time, a buffer between
visits, whether to return to the first stop, and whether booked times stay fixed
in the recommendation. Existing appointment durations come from their records;
unscheduled candidates use a 30-minute planning visit.

The recommendation compares every possible sequence for the selected first
property, using a directed matrix of road travel durations. At eight properties
this is at most 5,040 sequences with a chosen first property or 40,320 when the
first property is recommended. It minimizes estimated driving time, then finish
time and distance, with a deterministic tie break. One-way differences are
preserved. Parking/travel buffer, actual visit lengths and waiting for a fixed
appointment contribute to the proposed timeline.

If no sequence fits the fixed appointments, the planner says so. Choosing
flexible times produces a planning draft. **This embedded recommendation never changes appointments.** Save it as a named
tour to review and confirm the whole schedule in the saved-tour workspace. See
[SAVED_SHOWING_TOURS.md](SAVED_SHOWING_TOURS.md).

When a first property is chosen, the comparison starts there in both orders.
When the first property is recommended, the comparison uses the current
selected order. Travel to the first property is excluded in both cases. Savings
use the same road matrix and preferences. Unknown routes do not become zero
minutes. An order that cannot meet fixed appointments is not used to claim
savings. Optimizing time can increase distance. There is no
straight-line-distance conversion into purported driving time.

## Scope and fresh locations

Every context/recommendation read checks appointment ownership (including for
admins), current contact visibility and current private-list scope. The group
does not include another client or another day. Duplicate appointments for one
saved membership require resolution rather than silently choosing one.
Candidate reads are bounded and paged; the route selection is separately bounded.

POST accepts reviewed membership identifiers and planning preferences. It never
accepts client-supplied MLS coordinates, addresses or appointment times. The
server resolves current authorized properties and checks its context fingerprint
again before routing. Fresh resolved stops are returned with the recommendation
so map pins correspond to the locations actually used for calculation.

MLS properties with withheld addresses have no routable coordinates. Missing,
removed, unavailable or invalid locations remain explicitly unresolved; they
are not inferred or geocoded from suppressed information. Private research,
feedback and planning notes do not enter the routing projection.

## Live Google Maps connection

No mapping credentials were added or activated during this build. Real routing
requires all three settings:

```text
TOUR_ROUTING_ENABLED=true
GOOGLE_MAPS_ROUTES_API_KEY=<server-only Routes API key>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<restricted browser Maps JavaScript API key>
```

Use separate keys with the appropriate API and application restrictions.
The browser key is public by design; the server key never enters a client
projection, map URL or error. The provider constructor makes no requests.
Without explicit activation and both keys, routing returns Not connected.

The server requests a travel matrix for the chosen first-visit time and a road
polyline for the suggested order. Requests go only to the fixed Google Routes
API endpoints, contain coordinates/departure/routing preferences (plus user-entered start/end
addresses for saved tours), and omit
contact names, MLS identifiers, saved membership IDs and private text. Bodies
and response bodies are bounded and timed out. Billable recommendations are
never automatically retried.

Traffic estimates represent the selected first-visit time. Conditions during
later visits can change, so the UI labels the calculation time and recommends
refreshing before departure. This is a planning estimate, not live navigation.
Road-line failure can retain valid matrix estimates without fabricating a
replacement driving line.

Google route geometry appears only on a Google map; Google Maps attribution
also accompanies the estimates. Route results and geometry stay in component
memory: no database, browser-storage or shared-cache persistence is added.
Before live activation, the deployed product must meet the provider's setup,
attribution and applicable service requirements. Official references:
[route matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix),
[route requests](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
and [display/storage policies](https://developers.google.com/maps/documentation/routes/policies).

## Isolated preview

The Saturday tour fixture contains six fictional homes, one client and one day.
It uses an explicit asymmetric sample road matrix and the production optimizer.
Its sample map, road lines and drive times are clearly labelled illustrative.
No map tiles, routing services, credentials or live MLS data are used. The
original zigzag order has 103 sample driving minutes; a flexible order has 38.
Keeping appointments fixed preserves their actual fixture times. Preview
changes remain in memory and reset on reload.

The original embedded route panel needed no migration. The saved-tour update
adds migration 0023; migrations 0015–0023 remain unapplied to live databases. Presentations remain deferred for a future AI or
MCP integration.

## Verification

The final complete `npm test` run passed **6,342 counted checks**, plus the
unnumbered personal-workspace suite. New coverage includes 52 optimizer/provider
checks (with an independent directed-route cost oracle), 68 isolated PostgreSQL
scope/concurrency checks, 38 actual HTTP boundary checks, 24 UI checks and 60
actual-adapter checks. The isolated preview passed **102 groups**. Final
TypeScript and whitespace checks passed. No live routing request was made.

Desktop browser review calculated the fixed-time tour at 103 sample driving
minutes while retaining every booked visit, then calculated a flexible tour at
38 minutes with 65 minutes less driving. Automatic first-stop selection,
numbered map/itinerary selection, arrival/departure times and the comparison
were exercised. Selecting a pin brings its matching itinerary stop into view.
At 320×568 the controls fit without horizontal overflow, the map scrolls fully
into view, and the close action remains available. Sample captions remain
visible. Screenshots are saved separately in the local task outputs.
