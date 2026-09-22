/**
 * The brokerage roster, projected for one viewer.
 *
 * Pure and dependency-free so the visibility rules can be asserted without a
 * database. The rows come from real `dashboard_users` joined to their
 * professional profile and image; nothing here is generated, and a field the
 * user never filled in stays null rather than being made up.
 *
 * Who sees what (existing policy, reused — no new permissions system):
 *
 *   privileged (admin, broker, transaction coordinator)
 *       every account in the brokerage, including pending and suspended
 *       ones, with its account status.
 *   everyone else
 *       active colleagues only, and no status column — the same people and
 *       the same professional details their digital business cards publish.
 *
 * Never included, for anyone: the Clerk identifier, the verified sign-in
 * address as such (only the published contact address, exactly as the
 * business card chooses it), phone, NRDS, MLS agent id, biography or any
 * setting. The licence number IS included: it is public professional
 * information that the business card already shows, and it is labelled
 * self-reported.
 */
import { resolveImageUrl, publicContactEmail } from "../profile/display.ts";
import type { DbRole } from "../auth/actor.ts";

export type AccountStatus = "active" | "pending_profile" | "suspended";

export interface RosterSourceRow {
  userId: string;
  role: DbRole;
  status: AccountStatus;
  accountEmail: string | null;
  createdAt: Date | string | null;
  profile: {
    preferredDisplayName: string | null;
    legalFirstName: string | null;
    legalLastName: string | null;
    professionalTitle: string | null;
    licenseState: string | null;
    licenseType: string | null;
    licenseNumber: string | null;
    businessEmail: string | null;
  } | null;
  image: {
    processingStatus: string | null;
    processedImageUrl: string | null;
    activeImageUrl: string | null;
    clerkImageUrl: string | null;
  } | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  /** False when the user has not entered a name yet; the UI says so. */
  hasName: boolean;
  role: DbRole;
  roleLabel: string;
  title: string | null;
  licenseState: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  email: string | null;
  imageUrl: string | null;
  isSelf: boolean;
  /** Present only for privileged viewers. */
  status?: AccountStatus;
}

export interface RosterViewer {
  userId: string;
  privileged: boolean;
}

export const ROLE_LABEL: Record<DbRole, string> = {
  admin: "Admin",
  broker: "Broker",
  transaction_coordinator: "Transaction coordinator",
  agent: "Agent",
  member: "Member",
};

/** Senior roles first, then by name. Stable, so the table does not reshuffle. */
const ROLE_ORDER: Record<DbRole, number> = {
  admin: 0,
  broker: 1,
  transaction_coordinator: 2,
  agent: 3,
  member: 4,
};

function trimmed(v: string | null | undefined): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

export function displayName(profile: RosterSourceRow["profile"]): string | null {
  if (!profile) return null;
  return (
    trimmed(profile.preferredDisplayName) ??
    trimmed([profile.legalFirstName, profile.legalLastName].filter(Boolean).join(" "))
  );
}

export function toRosterEntry(row: RosterSourceRow, viewer: RosterViewer): RosterEntry {
  const name = displayName(row.profile);
  const entry: RosterEntry = {
    id: row.userId,
    name: name ?? "Name not added yet",
    hasName: name !== null,
    role: row.role,
    roleLabel: ROLE_LABEL[row.role] ?? "Member",
    title: trimmed(row.profile?.professionalTitle),
    licenseState: trimmed(row.profile?.licenseState),
    licenseType: trimmed(row.profile?.licenseType),
    licenseNumber: trimmed(row.profile?.licenseNumber),
    email: publicContactEmail(row.profile?.businessEmail, row.accountEmail),
    imageUrl: resolveImageUrl(row.image, { name: "", role: "", imageUrl: null }),
    isSelf: row.userId === viewer.userId,
  };
  if (viewer.privileged) entry.status = row.status;
  return entry;
}

export function rosterFor(rows: readonly RosterSourceRow[], viewer: RosterViewer): RosterEntry[] {
  return rows
    .filter((r) => viewer.privileged || r.status === "active")
    .map((r) => toRosterEntry(r, viewer))
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        Number(b.hasName) - Number(a.hasName) ||
        a.name.localeCompare(b.name)
    );
}
