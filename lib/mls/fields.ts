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

/** Property fields verified as publishable. */
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
];

/**
 * NOT yet verified for this dataset, so NOT selected. Listed so the intent is
 * written down: once `get_fields` confirms them, move them into
 * PROPERTY_FIELDS and the normaliser will start populating the listing agent
 * and neighbourhood from the record. Until then those stay absent rather than
 * guessed.
 */
export const UNVERIFIED_PROPERTY_FIELDS: readonly string[] = [
  "ListAgentFullName",
  "ListAgentDirectPhone",
  "ListAgentEmail",
  "ListOfficeName",
  "SubdivisionName",
  "MLSAreaMajor",
  "PhotosCount",
  "ExpirationDate",
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
