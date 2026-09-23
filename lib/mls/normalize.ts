/**
 * RESO record → FortMark `Listing`.
 *
 * The one place vendor field names are known. Everything downstream — the
 * listings screen, the detail page, the Home widget, the assistant's tools
 * later — sees only the domain model.
 *
 * Rules:
 *   - Nothing is invented. A field the feed does not carry is absent (or 0,
 *     where the domain model uses 0 for "not stated"), never estimated.
 *   - Unknown vendor enumerations map to an explicit "other"/"hold"-style
 *     bucket rather than to the nearest flattering value.
 *   - Pure: no I/O, importable by tests directly.
 */
import type { Listing, ListingStatus, PriceEvent, PropertyType } from "../data/types.ts";

/** A raw RESO Property record, as Bridge returns it. */
export type ResoRecord = Record<string, unknown>;

/** A raw RESO Media record. */
export type ResoMedia = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOpt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A RESO date (`2026-08-14`) or timestamp, as ISO. Absent stays absent. */
function isoDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * RESO StandardStatus → domain status.
 *
 * "Active Under Contract" is a distinct RESO status and is the one the
 * domain calls `underContract`. Cancelled listings are grouped with withdrawn:
 * both mean "no longer offered", and the domain has never distinguished them.
 * Anything unrecognised is `hold` — visibly not-active, never quietly active.
 */
export function toListingStatus(standardStatus: unknown): ListingStatus {
  const s = (str(standardStatus) ?? "").toLowerCase();
  switch (s) {
    case "active":
      return "active";
    case "coming soon":
      return "comingSoon";
    case "active under contract":
      return "underContract";
    case "pending":
      return "pending";
    case "closed":
      return "closed";
    case "expired":
      return "expired";
    case "withdrawn":
    case "canceled":
    case "cancelled":
      return "withdrawn";
    default:
      return "hold";
  }
}

/** Reverse map, for building a filter from a domain status. */
export const STANDARD_STATUS_FOR: Record<ListingStatus, readonly string[]> = {
  active: ["Active"],
  comingSoon: ["Coming Soon"],
  underContract: ["Active Under Contract"],
  pending: ["Pending"],
  closed: ["Closed"],
  expired: ["Expired"],
  withdrawn: ["Withdrawn", "Canceled"],
  hold: ["Hold"],
};

/**
 * RESO PropertyType + PropertySubType → domain property type.
 *
 * Sub-type carries the useful distinction for residential; PropertyType
 * catches land. Unknown combinations are `other`, not a guess.
 */
/**
 * RESO PropertyType values that mean land, and that mean multi-family income
 * property, as datasets actually spell them. `miamire` files land as
 * "Land/Boat Docks" (residential) and "Commercial Land", and duplexes through
 * quadruplexes under "Residential Income" — never under "Residential", and
 * never as the RESO-standard "Land" (both verified live 2026-09-23: the
 * standard spellings matched zero active listings). The standard spellings
 * stay in the lists so a conforming dataset still works.
 */
export const LAND_PROPERTY_TYPES: readonly string[] = ["Land", "Land/Boat Docks", "Commercial Land"];
export const INCOME_PROPERTY_TYPES: readonly string[] = ["Residential Income"];

export function toPropertyType(propertyType: unknown, propertySubType: unknown): PropertyType {
  const type = (str(propertyType) ?? "").toLowerCase();
  const sub = (str(propertySubType) ?? "").toLowerCase();
  if (LAND_PROPERTY_TYPES.some((t) => t.toLowerCase() === type) || sub === "unimproved land" || sub === "land") return "land";
  if (INCOME_PROPERTY_TYPES.some((t) => t.toLowerCase() === type)) return "multiFamily";
  if (sub === "single family residence" || sub === "single family") return "singleFamily";
  if (sub === "condominium" || sub === "condo") return "condo";
  if (sub === "townhouse") return "townhouse";
  if (
    sub === "multi family" ||
    sub === "multi-family" ||
    sub === "duplex" ||
    sub === "triplex" ||
    sub === "quadruplex"
  ) {
    return "multiFamily";
  }
  return "other";
}

/** Reverse map, for building a filter from a domain property type. */
export const PROPERTY_SUB_TYPES_FOR: Record<Exclude<PropertyType, "other">, readonly string[]> = {
  singleFamily: ["Single Family Residence"],
  condo: ["Condominium"],
  townhouse: ["Townhouse"],
  multiFamily: ["Multi Family", "Duplex", "Triplex", "Quadruplex"],
  land: ["Unimproved Land"],
};

/**
 * Street address from the structured parts, falling back to the unparsed
 * string. The structured form is preferred because UnparsedAddress on this
 * dataset often carries city/state/zip too, and the UI renders those itself.
 */
export function toStreetAddress(r: ResoRecord): string {
  const parts = [
    str(r.StreetNumber),
    str(r.StreetDirPrefix),
    str(r.StreetName),
    str(r.StreetSuffix),
  ].filter((p): p is string => Boolean(p));
  const unit = str(r.UnitNumber);
  if (parts.length > 0) {
    const line = parts.join(" ");
    return unit ? `${line} #${unit}` : line;
  }
  return str(r.UnparsedAddress) ?? "";
}

/**
 * Price events from what the feed states. This dataset publishes no price
 * history, so the only events a record can honestly carry are the list event
 * and, for a closed listing, the close.
 */
export function toPriceHistory(r: ResoRecord): PriceEvent[] {
  const events: PriceEvent[] = [];
  const listed = isoDate(r.ListingContractDate);
  const listPrice = numOpt(r.ListPrice);
  if (listed && listPrice !== undefined) {
    events.push({ date: listed, price: listPrice, kind: "listed" });
  }
  const closed = isoDate(r.CloseDate);
  const closePrice = numOpt(r.ClosePrice);
  if (closed && closePrice !== undefined) {
    events.push({ date: closed, price: closePrice, kind: "closed" });
  }
  return events;
}

/**
 * Convert one record. Returns null when the record lacks the two identifiers
 * the domain cannot function without — a row with no key cannot be linked to,
 * and a row with no MLS number cannot be looked up again.
 */
/** The address placeholder shown when the listing broker withholds it. */
export const WITHHELD_ADDRESS = "Address withheld by listing broker";

/** True for an explicit boolean false — or its string spelling — and nothing else. */
function isExplicitNo(v: unknown): boolean {
  return v === false || (typeof v === "string" && /^(false|n|no)$/i.test(v.trim()));
}

/**
 * Photo URLs carried on the Property record itself (`Media` collection), or
 * undefined when the record carries no such collection at all — which tells
 * the caller to ask the Media resource instead.
 */
export function embeddedPhotoUrls(r: ResoRecord): string[] | undefined {
  const media = r.Media;
  if (!Array.isArray(media)) return undefined;
  return toPhotoUrls(media as ResoMedia[]);
}

/** Per-request context the normaliser cannot know on its own. */
export interface ListingContext {
  /**
   * The caller's brokerage MLS office id, from brokerage identity. A row is
   * the brokerage's own when its listing or co-listing office matches. Absent
   * means no row is flagged — never a guess.
   */
  brokerageOfficeId?: string | null;
  /**
   * The signed-in agent's MLS member key (My Listings). When set, the listing
   * records the agent's role on it; nothing is flagged when absent.
   */
  memberKey?: string | null;
}

export function toListing(r: ResoRecord, photos: string[] = [], ctx: ListingContext = {}): Listing | null {
  const id = str(r.ListingKey);
  const mlsNumber = str(r.ListingId);
  if (!id || !mlsNumber) return null;
  // IDX: a listing the broker has excluded from internet display is not shown
  // anywhere. The feed already omits these; this is the guard if one arrives.
  if (isExplicitNo(r.InternetEntireListingDisplayYN)) return null;

  const addressWithheld = isExplicitNo(r.InternetAddressDisplayYN);
  const lat = addressWithheld ? undefined : numOpt(r.Latitude);
  const lng = addressWithheld ? undefined : numOpt(r.Longitude);
  const officeMlsId = str(r.ListOfficeMlsId);
  const coOfficeMlsId = str(r.CoListOfficeMlsId);
  const officeName = str(r.ListOfficeName);
  // The listing's own contract date, or nothing. A record's modification time
  // is not when it was listed, and showing it as "Listed" would state a fact
  // the feed never gave (one active Fort Lauderdale listing carries no contract
  // date at all). Empty renders as "—".
  const listedDate = isoDate(r.ListingContractDate) ?? "";

  const agentName = str(r.ListAgentFullName);

  return {
    id,
    mlsNumber,
    folioNumber: addressWithheld ? undefined : str(r.ParcelNumber),
    address: addressWithheld ? WITHHELD_ADDRESS : toStreetAddress(r),
    city: str(r.City) ?? "",
    zip: str(r.PostalCode) ?? "",
    neighborhood: str(r.SubdivisionName) ?? str(r.MLSAreaMajor),
    status: toListingStatus(r.StandardStatus),
    propertyType: toPropertyType(r.PropertyType, r.PropertySubType),
    listPrice: numOr(r.ListPrice, 0),
    closedPrice: numOpt(r.ClosePrice),
    beds: numOr(r.BedroomsTotal, 0),
    baths: numOr(r.BathroomsTotalInteger, 0),
    sqft: numOr(r.LivingArea, 0),
    lotSqft: numOpt(r.LotSizeSquareFeet),
    yearBuilt: numOpt(r.YearBuilt),
    listedDate,
    closedDate: isoDate(r.CloseDate),
    expiresDate: isoDate(r.ExpirationDate),
    daysOnMarket: numOpt(r.DaysOnMarket),
    agentId: "",
    listingAgent: agentName
      ? {
          name: agentName,
          phone: str(r.ListAgentDirectPhone),
          email: str(r.ListAgentEmail),
          office: str(r.ListOfficeName),
        }
      : undefined,
    photos: photos.length > 0 ? photos : (embeddedPhotoUrls(r) ?? []),
    description: str(r.PublicRemarks) ?? "",
    priceHistory: toPriceHistory(r),
    source: "mls",
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    listingOffice: officeName || officeMlsId ? { name: officeName, mlsId: officeMlsId } : undefined,
    isFortmark: Boolean(
      ctx.brokerageOfficeId &&
        (officeMlsId === ctx.brokerageOfficeId || coOfficeMlsId === ctx.brokerageOfficeId)
    ),
    ...(addressWithheld ? { addressWithheld: true } : {}),
    ...agentRoleFor(r, ctx.memberKey),
  };
}

/** The caller's role on a listing, by stable member key. Never by name. */
function agentRoleFor(r: ResoRecord, memberKey: string | null | undefined): { agentRole?: "primary" | "co_listing" } {
  if (!memberKey) return {};
  if (str(r.ListAgentKey) === memberKey) return { agentRole: "primary" };
  if (str(r.CoListAgentKey) === memberKey) return { agentRole: "co_listing" };
  return {};
}

/**
 * Photo URLs from Media records, in display order. Only HTTPS URLs are kept:
 * the browser renders these directly, and a feed row is not a trusted source
 * of anything else.
 */
export function toPhotoUrls(media: readonly ResoMedia[]): string[] {
  return [...media]
    .filter((m) => {
      const category = str(m.MediaCategory);
      return !category || /photo/i.test(category);
    })
    .sort((a, b) => numOr(a.Order, 0) - numOr(b.Order, 0))
    .map((m) => str(m.MediaURL))
    .filter((u): u is string => Boolean(u) && /^https:\/\//i.test(u as string));
}
