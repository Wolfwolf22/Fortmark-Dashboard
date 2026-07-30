/**
 * Contact and social shortcut construction for the Home identity card.
 *
 * Pure by design — no `server-only`, no database import — so every URL rule
 * here is unit-testable. The card never builds an `href` itself; it renders
 * whatever this module returns, and this module returns only links it has
 * already validated.
 *
 * Two separate concerns live here:
 *
 *   1. Which shortcuts exist at all. A link with no stored value is absent
 *      from the result, so the card renders nothing rather than a dead icon.
 *   2. Whether a stored value is safe to put in an `href`. Values round-trip
 *      through the database, so they are re-checked here even though
 *      `toProfileUrl` already checked them on write.
 */
import { safeLinkUrl } from "./display.ts";

/** Every shortcut kind the card can render. */
export type ContactLinkKind =
  | "linkedin"
  | "instagram"
  | "facebook"
  | "website"
  | "professionalWebsite"
  | "email"
  | "phone"
  | "whatsapp";

export interface ContactLink {
  kind: ContactLinkKind;
  /** Fully-formed, safe href. */
  href: string;
  /** Accessible label — also the tooltip text. */
  label: string;
  /** External links open in a new tab; mailto/tel navigate in place. */
  external: boolean;
}

/** The fields this builder may read. */
export interface ContactSource {
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  personalWebsiteUrl?: string | null;
  professionalWebsiteUrl?: string | null;
  email?: string | null;
  phoneE164?: string | null;
  whatsappPhoneE164?: string | null;
}

/**
 * A conservative email check. This is only ever the caller's own verified
 * Clerk address, but it still gets validated: a malformed value would produce
 * a broken `mailto:` and anything containing a newline or angle bracket has no
 * business in an href.
 */
export function toMailto(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 254) return null;
  if (!/^[^\s@<>"'();:,]+@[^\s@<>"'();:,]+\.[A-Za-z]{2,}$/.test(s)) return null;
  return `mailto:${s}`;
}

/**
 * `tel:` from an E.164 number. Values are stored normalised, so anything that
 * is not `+` followed by 8–15 digits is treated as unusable rather than
 * guessed at.
 */
export function toTel(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return `tel:${s}`;
}

/**
 * `https://wa.me/<digits>` — WhatsApp's documented click-to-chat form, which
 * takes the number without `+` or separators.
 */
export function toWhatsApp(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return `https://wa.me/${s.slice(1)}`;
}

/** Human-readable phone, e.g. +19545550100 → (954) 555-0100. */
export function formatPhoneDisplay(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(s);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : s;
}

/**
 * Build the ordered shortcut list, omitting everything without a usable value.
 *
 * Order is deliberate and stable: professional network first, then social,
 * then sites, then direct contact. A stable order means the icon row does not
 * reshuffle as a user fills their profile in.
 */
export function buildContactLinks(source: ContactSource): ContactLink[] {
  const links: ContactLink[] = [];

  const social: Array<[ContactLinkKind, unknown, string]> = [
    ["linkedin", source.linkedinUrl, "LinkedIn profile"],
    ["instagram", source.instagramUrl, "Instagram profile"],
    ["facebook", source.facebookUrl, "Facebook profile"],
    ["professionalWebsite", source.professionalWebsiteUrl, "Professional website"],
    ["website", source.personalWebsiteUrl, "Personal website"],
  ];
  for (const [kind, value, label] of social) {
    const href = safeLinkUrl(value);
    if (href) links.push({ kind, href, label, external: true });
  }

  const email = toMailto(source.email);
  if (email) links.push({ kind: "email", href: email, label: "Send email", external: false });

  const tel = toTel(source.phoneE164);
  if (tel) links.push({ kind: "phone", href: tel, label: "Call", external: false });

  const wa = toWhatsApp(source.whatsappPhoneE164);
  if (wa) links.push({ kind: "whatsapp", href: wa, label: "WhatsApp", external: true });

  return links;
}

/**
 * The business-contact block used by "Copy Contact Info".
 *
 * Only ever the signed-in user's own approved fields, and only fields that
 * actually have a value — no empty labels, no placeholder lines. Plain text so
 * it pastes cleanly into an email signature or a CRM note.
 */
export interface ContactBlockSource extends ContactSource {
  displayName?: string | null;
  professionalTitle?: string | null;
  roleLabel?: string | null;
  brokerageOffice?: string | null;
  locationDisplay?: string | null;
  licenseState?: string | null;
  licenseType?: string | null;
  licenseNumber?: string | null;
}

export function buildContactBlock(source: ContactBlockSource): string {
  const lines: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) lines.push(s);
  };

  push(source.displayName);
  push(source.professionalTitle ?? source.roleLabel);

  const org = [source.brokerageOffice, source.locationDisplay]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(" · ");
  if (org) lines.push(`FortMark · ${org}`);
  else lines.push("FortMark");

  const licence = [source.licenseState, source.licenseType, source.licenseNumber]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (licence) lines.push(`License ${licence}`);

  const email = typeof source.email === "string" ? source.email.trim() : "";
  if (toMailto(email)) lines.push(email);

  const phone = formatPhoneDisplay(source.phoneE164);
  if (phone) lines.push(phone);

  for (const url of [source.professionalWebsiteUrl, source.personalWebsiteUrl, source.linkedinUrl]) {
    const safe = safeLinkUrl(url);
    if (safe) lines.push(safe);
  }

  return lines.join("\n");
}
