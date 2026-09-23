import "server-only";
/**
 * What the listings routes need to know about the caller, resolved once per
 * request from the session — never from the request body or query:
 *
 *   privileged  admin / broker / transaction coordinator (FortMark scope by default)
 *   officeId    FortMark's MLS office (system configuration)
 *   identity    the caller's linked MLS member, or why there is none
 *
 * No MLS request is made here; everything is configuration or stored rows.
 */
import { resolveActor, isPrivileged } from "../auth/actor.ts";
import { profileDatabaseEnabled } from "../flags.ts";
import { brokerageMlsOfficeId } from "../brokerage/service.ts";
import { listingIdentityFor, type ListingIdentity } from "./service.ts";

export interface CallerListingContext {
  privileged: boolean;
  officeId: string | null;
  officeKnown: boolean;
  identity: ListingIdentity;
}

export async function callerListingContext(clerkUserId: string): Promise<CallerListingContext> {
  const office = await brokerageMlsOfficeId(clerkUserId);
  const officeId = office.ok ? office.officeId : null;
  const actor = await resolveActor(clerkUserId, profileDatabaseEnabled());
  if (!actor.ok) {
    return { privileged: false, officeId, officeKnown: office.ok, identity: { ok: false, state: "unavailable" } };
  }
  return {
    privileged: isPrivileged(actor.actor),
    officeId,
    officeKnown: office.ok,
    identity: await listingIdentityFor(actor.actor.userId, actor.db),
  };
}
