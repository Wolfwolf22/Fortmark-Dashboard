/**
 * vCard 3.0 generation for the internal digital business card.
 *
 * Pure and synchronous: the card is generated on demand from data already on
 * screen and handed to a blob download. Nothing is persisted server-side, and
 * no public URL is created — a vCard is a file the user saves, not a page.
 *
 * vCard is a line-based format, so every interpolated value must have its
 * separators neutralised or a name containing a comma silently becomes two
 * fields. `escapeValue` handles that.
 */

export interface VCardSource {
  displayName: string;
  professionalTitle?: string | null;
  roleLabel?: string | null;
  brokerageOffice?: string | null;
  locationDisplay?: string | null;
  email?: string | null;
  phoneE164?: string | null;
  websiteUrl?: string | null;
  licenseState?: string | null;
  licenseType?: string | null;
  licenseNumber?: string | null;
  nrdsNumber?: string | null;
}

/** Escape the characters that carry structural meaning in a vCard value. */
export function escapeValue(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function splitName(displayName: string): { family: string; given: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { family: "", given: "" };
  if (parts.length === 1) return { family: "", given: parts[0] };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

/**
 * Build a vCard 3.0 document.
 *
 * Only fields with values are emitted — an empty `TEL:` line is worse than no
 * line, because address books will import it as a blank entry. Lines are joined
 * with CRLF as the spec requires.
 */
export function buildVCard(source: VCardSource): string {
  const { family, given } = splitName(source.displayName);
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(`N:${escapeValue(family)};${escapeValue(given)};;;`);
  lines.push(`FN:${escapeValue(source.displayName)}`);

  const title = source.professionalTitle ?? source.roleLabel;
  if (title) lines.push(`TITLE:${escapeValue(title)}`);

  const org = ["FortMark", source.brokerageOffice].filter(Boolean).join(";");
  lines.push(`ORG:${escapeValue(org)}`);

  if (source.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeValue(source.email)}`);
  if (source.phoneE164) lines.push(`TEL;TYPE=WORK,VOICE:${escapeValue(source.phoneE164)}`);
  if (source.websiteUrl) lines.push(`URL:${escapeValue(source.websiteUrl)}`);
  if (source.locationDisplay) {
    lines.push(`ADR;TYPE=WORK:;;;${escapeValue(source.locationDisplay)};;;`);
  }

  // Licence and NRDS go in NOTE rather than invented X- fields, so they survive
  // an import into any address book instead of being dropped.
  const note = [
    [source.licenseState, source.licenseType, source.licenseNumber].filter(Boolean).join(" ")
      ? `License ${[source.licenseState, source.licenseType, source.licenseNumber].filter(Boolean).join(" ")}`
      : null,
    source.nrdsNumber ? `NRDS ${source.nrdsNumber}` : null,
  ].filter(Boolean);
  if (note.length > 0) lines.push(`NOTE:${escapeValue(note.join(" · "))}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** `daniel-wolf.vcf` — a safe, predictable download filename. */
export function vCardFilename(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "fortmark-contact"}.vcf`;
}
