import "server-only";

/**
 * Bridges the profile service to the dashboard shell.
 *
 * The contract this module exists to enforce: **the shell renders the same
 * whether or not the database is working.** Every failure path here returns a
 * session-only projection rather than throwing, so a Neon outage, a missing
 * row, or a disabled flag degrades the identity strip to what the dashboard
 * already showed before Release 1 — never to an error page and never to a
 * denied request.
 */
import {
  professionalProfileUiEnabled,
  profileDatabaseEnabled,
  type EnvLike,
} from "../flags.ts";
import { toProfileDisplay, type ShellProfile } from "./display.ts";
import {
  fallbackHomeIdentityCard,
  toHomeIdentityCard,
  type HomeIdentityCard,
} from "./home-card.ts";
import { syncCurrentUser, type ClerkIdentity } from "./service.ts";
import {
  resumeStep,
  shouldOpenOnboarding,
  stepsForRole,
  type OnboardingStep,
  type ProfileFieldKey,
} from "./onboarding.ts";
import type { SessionUser } from "../auth/session.ts";

export type { ShellProfile };

/** The session-only projection. The floor that every failure path lands on. */
export function fallbackShellProfile(user: SessionUser): ShellProfile {
  return {
    display: toProfileDisplay({
      name: user.name,
      role: user.role,
      imageUrl: user.imageUrl,
    }),
    editable: false,
  };
}

/**
 * Resolve the shell's identity strip for the current request.
 *
 * Calls `syncCurrentUser`, which independently re-checks the allowlist before
 * touching the database — being signed in is not enough to provision a row.
 */
export async function getShellProfile(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<ShellProfile> {
  if (!professionalProfileUiEnabled(env)) return fallbackShellProfile(user);

  const identity: ClerkIdentity = {
    clerkUserId: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    roleLabel: user.role,
  };

  try {
    const synced = await syncCurrentUser(identity, env);
    if (!synced) return fallbackShellProfile(user);

    return {
      display: toProfileDisplay(
        { name: user.name, role: user.role, imageUrl: user.imageUrl },
        synced.profile,
        synced.image
      ),
      editable: true,
    };
  } catch {
    // Swallowed on purpose. A profile problem must never become an access
    // problem while the allowlist is the access authority.
    return fallbackShellProfile(user);
  }
}

/**
 * The Home identity card for the current request. Never null.
 *
 * Authentication and the allowlist have already approved this request before
 * this function is reached, so the card is owed to the user unconditionally.
 * The database *enriches* the card; it does not gate it. Every failure path
 * returns the session-only projection instead of nothing, because a profile
 * problem must never remove a surface the user is entitled to — the same rule
 * that keeps a database outage from becoming an access outage.
 *
 * Enrichment is gated on `profileDatabaseEnabled` alone, NOT on
 * `professionalProfileUiEnabled`. The UI flag governs optional chrome — the
 * drawer and the profile editor — which genuinely has nothing to show without
 * profile rows, so it ANDs both flags. The card is not optional chrome: it
 * renders either way, and the only question this gate has to answer is the
 * narrower "may we read profile rows?". Gating it on the compound flag made a
 * permanent surface depend on two variables where one is meaningful, and a
 * missing UI flag silently stripped the card back to session data.
 *
 * `syncCurrentUser` is reused rather than a second read path: it already
 * re-checks the allowlist before touching the database and returns the user,
 * profile and image rows this projection needs.
 */
export async function getHomeIdentityCard(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<HomeIdentityCard> {
  const session = {
    name: user.name,
    role: user.role,
    email: user.email,
    imageUrl: user.imageUrl,
  };
  const fallback = fallbackHomeIdentityCard(session);

  if (!profileDatabaseEnabled(env)) return fallback;

  const identity: ClerkIdentity = {
    clerkUserId: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    roleLabel: user.role,
  };

  try {
    const synced = await syncCurrentUser(identity, env);
    if (!synced) return fallback;
    return toHomeIdentityCard(session, synced.user, synced.profile, synced.image);
  } catch {
    // Swallowed on purpose, and without inspecting the error: a driver error
    // can carry the host and user portion of a connection string, and the card
    // is owed to the user whatever went wrong underneath it.
    return fallback;
  }
}


/**
 * Everything the onboarding route and the Home page need to decide whether to
 * show the wizard, and where to resume.
 *
 * Resolved on the SERVER, through the same `syncCurrentUser` path every other
 * profile read uses — so the allowlist is re-checked before any row is touched
 * and no database call happens in middleware.
 *
 * `available: false` covers every reason the wizard cannot work: flags off, the
 * database unreachable, sync refused, or an exception. The caller sends those
 * users to the ordinary dashboard rather than trapping them in a wizard whose
 * saves would fail.
 */
export interface OnboardingContext {
  available: boolean;
  complete: boolean;
  resumeStep: number;
  steps: readonly OnboardingStep[];
  values: Partial<Record<ProfileFieldKey, string | null>>;
  accountEmail: string | null;
  role: string | null;
}

const UNAVAILABLE: OnboardingContext = {
  available: false,
  complete: false,
  resumeStep: 1,
  steps: [],
  values: {},
  accountEmail: null,
  role: null,
};

export async function onboardingContext(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<OnboardingContext> {
  if (!professionalProfileUiEnabled(env)) return UNAVAILABLE;

  const identity: ClerkIdentity = {
    clerkUserId: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    roleLabel: user.role,
  };

  try {
    const synced = await syncCurrentUser(identity, env);
    if (!synced) return UNAVAILABLE;

    const role = synced.user.role ?? null;
    const p = synced.profile;
    return {
      available: true,
      complete: Boolean(synced.user.onboardingComplete),
      resumeStep: resumeStep(p?.onboardingStep ?? null, role).step,
      steps: stepsForRole(role),
      values: {
        preferredDisplayName: p?.preferredDisplayName ?? null,
        legalFirstName: p?.legalFirstName ?? null,
        legalLastName: p?.legalLastName ?? null,
        professionalTitle: p?.professionalTitle ?? null,
        brokerageOffice: p?.brokerageOffice ?? null,
        locationDisplay: p?.locationDisplay ?? null,
        biography: p?.biography ?? null,
        licenseState: p?.licenseState ?? null,
        licenseType: p?.licenseType ?? null,
        licenseNumber: p?.licenseNumber ?? null,
        licenseExpiration: p?.licenseExpiration ?? null,
        nrdsNumber: p?.nrdsNumber ?? null,
        businessEmail: p?.businessEmail ?? null,
        phoneE164: p?.phoneE164 ?? null,
        whatsappPhoneE164: p?.whatsappPhoneE164 ?? null,
        personalWebsiteUrl: p?.personalWebsiteUrl ?? null,
        professionalWebsiteUrl: p?.professionalWebsiteUrl ?? null,
        linkedinUrl: p?.linkedinUrl ?? null,
        instagramUrl: p?.instagramUrl ?? null,
        facebookUrl: p?.facebookUrl ?? null,
      },
      // The verified Clerk address, shown read-only. Never writable here.
      accountEmail: synced.user.primaryEmail ?? user.email ?? null,
      role,
    };
  } catch {
    // A profile problem must never become an access problem.
    return UNAVAILABLE;
  }
}

/**
 * Whether Home should send this user into onboarding.
 *
 * Kept separate from `onboardingContext` so the Home page can ask the cheap
 * question without the caller having to remember every condition.
 */
export async function shouldRedirectToOnboarding(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<boolean> {
  const context = await onboardingContext(user, env);
  return shouldOpenOnboarding({
    uiEnabled: professionalProfileUiEnabled(env),
    databaseEnabled: profileDatabaseEnabled(env),
    databaseAvailable: context.available,
    user: context.available ? { onboardingComplete: context.complete ? new Date() : null } : null,
  });
}
