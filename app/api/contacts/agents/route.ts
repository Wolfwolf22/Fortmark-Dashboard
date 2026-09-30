import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeadAgents } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listAgents } from "@/lib/contacts/service";
import { isBrokerageAdmin } from "@/lib/auth/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owners the contacts screen may filter by — an admin only.
 *
 * Everyone else sees only their own contacts, so there is nobody for them to
 * filter by; the list is empty for them rather than a roster of colleagues
 * whose contacts they cannot see. Read-only: contacts are never handed off. Names only — never an
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
  if (!isBrokerageAdmin(actor.ctx.actor)) {
    return NextResponse.json({ items: [] }, { headers: NO_STORE });
  }
  try {
    const items = await listAgents(actor.ctx);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
