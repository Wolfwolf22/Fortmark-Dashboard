import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeadAgents } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listAgents } from "@/lib/contacts/service";
import { isPrivileged } from "@/lib/auth/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agents the leads screen may filter by.
 *
 * A non-privileged caller sees only their own contacts, so the only agent
 * they can filter by is themselves; the list is empty for them rather than a
 * roster of colleagues whose contacts they cannot see. Names only — never an
 * email, a Clerk id, or anything else from the user row.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  if (contactsSource() === "sample") {
    return NextResponse.json({ items: listSampleLeadAgents() }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  if (!isPrivileged(actor.ctx.actor)) {
    return NextResponse.json({ items: [] }, { headers: NO_STORE });
  }
  try {
    const items = await listAgents(actor.ctx);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
