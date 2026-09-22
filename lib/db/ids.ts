/**
 * What a record id looks like, before it is allowed near a query.
 *
 * Every database id in FortMark is a Postgres uuid. A path segment that is
 * not one — "not-a-uuid", a sample-mode token, a typo — cannot name a record,
 * so the honest answer is the same as for an id that names nobody's record:
 * not found. Without this check the string reaches Postgres, the uuid cast
 * fails, and the route's catch reports the *service* as unavailable — a 503
 * produced by user input, and a false signal to anything watching for
 * outages.
 *
 * Checked in the domain services rather than the routes, so every caller —
 * a route, an AI tool, a future job — inherits it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
