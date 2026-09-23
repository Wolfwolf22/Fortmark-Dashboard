import "server-only";
/**
 * The one hook profile and onboarding saves call after a successful write.
 * Resolves the MLS identity only if the licence changed; never throws, never
 * fails the save that called it.
 */
import { resolveActor } from "../auth/actor.ts";
import { profileDatabaseEnabled } from "../flags.ts";
import { resolveIfLicenceChanged } from "./service.ts";
import type { MlsIdentityState } from "./rules.ts";

export async function matchLicenceAfterSave(clerkUserId: string): Promise<MlsIdentityState | null> {
  try {
    const actor = await resolveActor(clerkUserId, profileDatabaseEnabled());
    if (!actor.ok) return null;
    return await resolveIfLicenceChanged(actor.actor.userId);
  } catch {
    return null;
  }
}
