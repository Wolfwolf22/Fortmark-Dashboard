/**
 * The professional-title catalogue.
 *
 * A professional title is a DISPLAY string. It is not a role, not a
 * permission, and not a licence. Nothing in this module is consulted by
 * `lib/auth/dashboard-access.ts` or by `resolveDbRole`, and selecting
 * "Managing Broker" here grants exactly as much authority as selecting
 * nothing — which is none. That separation is the reason this list lives
 * apart from `lib/profile/roles.ts` rather than being folded into it.
 *
 * Storage is the stable `value`, never the label, so the wording of a title
 * can be corrected without rewriting stored rows.
 */

export interface ProfessionalTitleOption {
  /** Stored in `professional_profiles.professional_title`. */
  value: string;
  /** Rendered to humans. Safe to change without a data migration. */
  label: string;
}

/**
 * The offered titles.
 *
 * Deliberately distinct from `LICENSE_TYPES` in `normalize.ts`, which
 * describes what a state licence says ("Sales Associate", "Broker",
 * "Property Manager"). A licence type is a regulatory fact; a professional
 * title is how someone introduces themselves. They overlap in wording and
 * must not be merged — an agent may hold a Broker licence and present as a
 * "Residential Real Estate Advisor".
 */
export const PROFESSIONAL_TITLES: readonly ProfessionalTitleOption[] = [
  { value: "real_estate_sales_associate", label: "Real Estate Sales Associate" },
  { value: "broker_associate", label: "Broker Associate" },
  { value: "broker", label: "Broker" },
  { value: "managing_broker", label: "Managing Broker" },
  { value: "principal_broker", label: "Principal Broker" },
  { value: "transaction_manager", label: "Transaction Manager" },
  { value: "commercial_real_estate_advisor", label: "Commercial Real Estate Advisor" },
  { value: "residential_real_estate_advisor", label: "Residential Real Estate Advisor" },
  { value: "real_estate_advisor", label: "Real Estate Advisor" },
] as const;

const BY_VALUE = new Map(PROFESSIONAL_TITLES.map((t) => [t.value, t]));
const BY_LABEL = new Map(
  PROFESSIONAL_TITLES.map((t) => [t.label.toLowerCase(), t])
);

/** Whether a stored string is one of the catalogue values. */
export function isKnownTitleValue(v: unknown): boolean {
  return typeof v === "string" && BY_VALUE.has(v);
}

/**
 * Canonicalise a submitted title.
 *
 * Accepts either the stable value (`broker_associate`) or the human label
 * ("Broker Associate", any casing), so a client that posts what it rendered
 * still stores the canonical form.
 *
 * A value matching neither is returned CLEANED BUT UNCHANGED rather than
 * rejected. That is the backward-compatibility rule: rows written before this
 * catalogue existed hold free text like "Realtor®", and refusing or blanking
 * them would destroy data the user never asked to change. An unrecognised
 * title is legacy, not invalid.
 */
export function canonicalizeTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length === 0) return null;
  if (BY_VALUE.has(s)) return s;
  const byLabel = BY_LABEL.get(s.toLowerCase());
  if (byLabel) return byLabel.value;
  return s;
}

/**
 * The label to display for a stored title.
 *
 * A legacy free-text value is shown exactly as stored — it is still the user's
 * own words, and inventing a prettier form would misquote them.
 */
export function titleLabel(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const s = stored.trim();
  if (s.length === 0) return null;
  return BY_VALUE.get(s)?.label ?? s;
}

/**
 * The options a select should offer for a given stored value.
 *
 * When the stored value is legacy, it is prepended as its own option so the
 * control can represent the current state truthfully. Without this the select
 * would render with nothing selected, and the first save would silently
 * replace a value the user never touched.
 */
export function titleOptionsFor(
  stored: string | null | undefined
): readonly ProfessionalTitleOption[] {
  const s = typeof stored === "string" ? stored.trim() : "";
  if (s.length === 0 || BY_VALUE.has(s)) return PROFESSIONAL_TITLES;
  return [{ value: s, label: s }, ...PROFESSIONAL_TITLES];
}
