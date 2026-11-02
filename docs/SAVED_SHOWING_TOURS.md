# Saved showing tours

Local implementation, 2026-11-02. A saved tour is an owner-private, named plan
for one client and one saved property list. Create it before booking any
appointments, or save the selected stops and settings from a showing's route
panel. The full workspace lives at `/showing-tours`; contact and property-list
launchers open that workspace.

## Plan, save, review, confirm

1. Choose a client, a private saved list and two to eight memberships. Personal
   research lists remain personal; choosing a tour client does not transfer or
   relink the list. Candidate properties are paged. No automatic matching.
2. Name the tour, set a New York date/time, private notes, property order, visit
   durations and a parking/travel buffer. Save works without a Maps connection.
3. Optionally enter a departure address and choose to finish at the last home,
   return to the start, or finish at a different address. With a departure
   address the time means departure; otherwise it means the first property visit.
4. Existing appointments can stay locked. Locked visits keep their exact booked
   start and end. Flexible appointments are proposed moves; unbooked properties
   are proposed new appointments. A route review does not write any appointment.
5. Save changes, then explicitly request a fresh route and schedule review. The
   review shows old and proposed times, new/moved/kept slots and the route.
6. Confirm the reviewed schedule once. One transaction applies every slot or
   none. Any overlap, stale revision, changed source, expired review or lost
   permission refuses the whole schedule. Existing meetings, private notes and
   feedback survive rescheduling. Unselected appointments are never cancelled.

Planning and scheduling do not log an actual contact touch, complete a visit,
change the contact's Next Action, send invitations or send messages. Those are
separate deliberate workflows. Archiving a plan keeps its appointments intact.

## Routing and locations

The exact optimizer considers directed road durations, endpoint travel, visit
lengths, buffers and fixed-time waits. The objective is minimum driving, then
finish time and distance, with stable tie breaking. Unknown road edges are not
zero-minute trips; infeasible baselines do not claim savings.

Custom endpoints are user-authored addresses. The server sends them only in
JSON bodies to the existing fixed Google Routes API endpoints. They never enter
URLs or audit metadata. Route responses must resolve each address exactly and
provide a valid map point. Ambiguous, partial or unresolved endpoints refuse the
review. MLS coordinates still come only from the authorized current MLS source;
withheld or missing property locations are never inferred from an address.

Road estimates and geometry use the connection documented in
[SHOWING_TOURS.md](SHOWING_TOURS.md). No new key or separate geocoding service is
introduced. Live Maps remains disabled until separately configured. Google
geometry is displayed only on a Google map, with attribution also beside the
estimates. All returned Google durations, coordinates and polylines remain in
component memory; they are not stored in SQL, browser storage or shared caches.
Relevant official API references: [address waypoints](https://developers.google.com/maps/documentation/routes/reference/rest/v2/Waypoint),
[route response and geocoding results](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
and [display/storage policies](https://developers.google.com/maps/documentation/routes/policies).

## Persistence and concurrency

Additive migration `0023_saved_showing_tours.sql` creates private tour metadata,
ordered stop references and safe mutation receipts. Tour names/notes/raw endpoint
addresses are user input; properties remain membership IDs and bookings remain
showing IDs. No listing content or routing response is copied into these tables.

Reads require both tour ownership and current client visibility, including for
administrators. Source list access and every selected membership are rechecked.
An unavailable source can leave the owner's draft readable with unavailable
property references; it cannot be reviewed or scheduled. Members cannot mutate.

Create uses a stable request UUID and payload hash. Edits/archives compare the
reviewed revision. Schedule confirmation uses a 15-minute HMAC review signed by
a per-tour, server-only random key. It binds actor, tour, revision, the fresh
source fingerprint and exact reviewed slots. Any draft edit discards the review
in the browser. Tokens hold IDs and times, never raw endpoints or Google results.

Confirmation locks the owner, sorted contacts, source list, memberships, tour,
stops and bookings, then rechecks source revisions and all same-owner scheduled
overlaps in the guarded receipt transaction. Unknown write outcomes retain the
same UUID/payload for an explicit retry; writes are never automatically retried.
An already committed exact retry can recover after review expiry, subject to
current authorization. Receipts and audits contain safe IDs/state words only.

Contact merging fingerprints and locks all saved tours and stops, including
other owners' private rows. It reparents their client references, advances tour
revisions and retains stop identities, order, settings, signing keys and original
request anchors. Visible counts include only the caller's private tours.

## Local verification and release limits

The interactive preview uses fictional clients, properties and explicit road
matrix cells. Recognized sample endpoint addresses are `Sample FortMark office`,
`Sample client meeting point` and `Sample coastal meeting point`. Unknown sample
addresses remain unresolved; no external geocoding or routing occurs. Every
preview write is memory-only and resets on reload.

Verification covers isolated PostgreSQL rollback, exact replay, owner privacy,
source/permission races, atomic overlap guards, signed review expiry/tampering,
contact merges, endpoint optimization, synthetic provider failures, actual HTTP
and adapter boundaries, UI state and the complete preview interaction. The
release record and screenshots are saved in the task outputs. The full test
chain passed 6,718 counted checks plus the unnumbered workspace suite; final
UI checks were expanded to 28 after the settings-load regression fix. The
preview passed 118 groups. TypeScript and whitespace checks passed.

Migrations 0015–0023 remain unapplied to live databases. No live routing calls,
production deployment, remote Git push or communication occurred. Client
presentations remain deferred for a future AI/MCP integration.
