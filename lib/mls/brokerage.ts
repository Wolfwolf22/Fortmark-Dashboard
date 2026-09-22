/**
 * Brokerage identity inside the MLS. Pure constants; safe to import anywhere.
 */

/**
 * FortMark's MLS office identifier in `miamire`.
 *
 * Authoritative, not a name match: every current listing whose
 * `ListOfficeName` is "FortMark, LLC" carries `ListOfficeMlsId = FTMK01`
 * (`ListOfficeKey 445b411d…`), and filtering by the id returns exactly the
 * same set (verified through the FortMark MCP on 2026-09-22). Co-listings
 * are matched on `CoListOfficeMlsId` as well.
 */
export const FORTMARK_LIST_OFFICE_MLS_ID = "FTMK01";
