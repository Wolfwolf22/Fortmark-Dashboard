/**
 * OData filter construction for Bridge.
 *
 * Pure functions, no I/O, no credentials — importable by tests directly. The
 * escaping and clause-joining rules match the MCP server's so a filter that
 * works there works here.
 */

/** Single quotes are doubled inside an OData string literal. */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** `Field eq 'value'`, value escaped. */
export function eq(field: string, value: string): string {
  return `${field} eq '${escapeODataString(value)}'`;
}

/** `Field eq 'a' or Field eq 'b'`, parenthesised so it ANDs cleanly. */
export function anyOf(field: string, values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return eq(field, values[0]);
  return values.map((v) => eq(field, v)).join(" or ");
}

/** Join clauses with AND, each parenthesised, dropping blanks. */
export function andFilters(clauses: ReadonlyArray<string | undefined | null>): string {
  return clauses
    .filter((c): c is string => Boolean(c && c.trim()))
    .map((c) => `(${c})`)
    .join(" and ");
}

/**
 * A number for a filter clause. Rejects anything that is not a finite number
 * so a NaN from a bad query string cannot reach the upstream as `ge NaN`.
 */
export function num(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Does this look like an MLS number rather than a street address?
 *
 * Local MLS numbers are letter-prefixed digit runs (`A11234567`, `F10471234`,
 * `RX-10987654`). A match routes the query to an exact `ListingId` lookup; a
 * miss routes it to an address search. Deliberately narrow: an address that
 * happened to match would become a lookup that finds nothing, which is a
 * worse failure than an MLS number being searched as text.
 */
export function looksLikeMlsNumber(query: string): boolean {
  return /^[A-Z]{1,3}-?\d{5,10}$/i.test(query.trim());
}
