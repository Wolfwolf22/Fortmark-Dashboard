/**
 * RESO fields this dashboard requests from Bridge.
 *
 * Bridge rejects the WHOLE query when `$select` names a field the dataset
 * does not publish, so nothing goes in a projection until it has been
 * confirmed against the live dataset. The sets below are the ones the MCP
 * server verified for the miamire dataset (its `lib/bridge.ts` DEFAULT_FIELDS
 * and BUILDING_FIELDS, confirmed by `scripts/verify_bridge_fields.ts`).
 *
 * Adding a field: confirm it with the MCP's `get_fields` tool (or the Fields
 * resource) first, then add it here. Never guess.
 */

/**
 * Property fields verified as publishable.
 *
 * Confirmed against the `miamire` dataset's Fields resource through the
 * FortMark MCP `get_fields` tool on 2026-09-22 (537 names published).
 */
export const PROPERTY_FIELDS: readonly string[] = [
  "ListingKey",
  "ListingId",
  "StandardStatus",
  "PropertyType",
  "PropertySubType",
  "ListPrice",
  "ClosePrice",
  "CloseDate",
  "UnparsedAddress",
  "StreetNumber",
  "StreetDirPrefix",
  "StreetName",
  "StreetSuffix",
  "UnitNumber",
  "City",
  "PostalCode",
  "StateOrProvince",
  "ParcelNumber",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "LivingArea",
  "LotSizeSquareFeet",
  "YearBuilt",
  "DaysOnMarket",
  "ListingContractDate",
  "ModificationTimestamp",
  "PublicRemarks",
  "Latitude",
  "Longitude",
  // Attribution and brokerage identity (verified 2026-09-22).
  "ListAgentFullName",
  "ListAgentMlsId",
  "ListOfficeName",
  "ListOfficeMlsId",
  "CoListOfficeMlsId",
  // Agent association for My Listings (verified 2026-09-23 against the live
  // field catalogue and FortMark's own listings: primary + one co-listing
  // agent; this MLS has no second/third co-list fields). Read server-side to
  // derive the caller's role on a listing; never sent to the browser.
  "ListAgentKey",
  "CoListAgentKey",
  "CoListAgentMlsId",
  "SubdivisionName",
  "MLSAreaMajor",
  "PhotosCount",
  "ExpirationDate",
  // IDX display controls (verified 2026-09-22). Honoured by the normaliser.
  "InternetEntireListingDisplayYN",
  "InternetAddressDisplayYN",
];

/**
 * The embedded media collection on Property. In `miamire` this is where the
 * photo URLs actually live: the standalone Media resource returns its rows
 * with `MediaURL: null` (observed 2026-09-22), so a gallery built from it
 * would always be empty. Selected alongside PROPERTY_FIELDS wherever photos
 * are shown.
 */
export const EMBEDDED_MEDIA_FIELD = "Media";

/**
 * Present in the dataset but deliberately NOT selected: agent direct contact
 * details. The dashboard attributes the listing office and agent name; it does
 * not republish an agent's personal phone or email from the feed.
 */
export const UNVERIFIED_PROPERTY_FIELDS: readonly string[] = [
  "ListAgentDirectPhone",
  "ListAgentEmail",
];

/**
 * Media resource fields. `ResourceRecordKey` and `Order` are the two the MCP
 * filters and sorts on; `MediaURL` is the RESO standard name for the asset
 * and is what the Media resource exists to carry.
 */
export const MEDIA_FIELDS: readonly string[] = [
  "ResourceRecordKey",
  "MediaURL",
  "Order",
  "MediaCategory",
];

export function selectClause(fields: readonly string[]): string {
  return fields.join(",");
}
