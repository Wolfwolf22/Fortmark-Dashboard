import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeads } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { contactSnapshot } from "@/lib/contacts/service";
import { snapshotOf } from "@/lib/contacts/windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Leads snapshot: how many contacts are active, new, due, overdue and gone
 * quiet, and how many sit in each stage — over exactly the contacts this caller
 * may list. Counts only; no names, no ids.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  if (contactsSource() === "sample") {
    return NextResponse.json({ snapshot: snapshotOf(listSampleLeads(), new Date()) }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    return NextResponse.json({ snapshot: await contactSnapshot(actor.ctx) }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
