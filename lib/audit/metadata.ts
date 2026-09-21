/**
 * The single denylist for audit metadata.
 *
 * Lives on its own so every writer shares it. An audit row is written on a
 * path that has already handled a credential or a Clerk identifier, and the
 * cost of one careless key is a secret persisted in a table built to be read
 * later, so the scrub is defensive rather than a matter of caller discipline.
 */

/** Keys that must never appear in audit metadata, whatever the caller passes. */
const FORBIDDEN_META = /token|secret|cookie|authorization|password|clerk_?user_?id|session/i;

export function scrubMetadata(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META.test(k)) continue;
    // A raw Clerk id under an innocent key is still a raw Clerk id.
    if (typeof v === "string" && /^user_[A-Za-z0-9]{8,}$/.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
