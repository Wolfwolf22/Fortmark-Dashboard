import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listEligibleContacts } from "@/lib/contacts/eligible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contacts a new transaction may be opened for: at Representation, within the
 * caller's own Contacts scope, matching a typed name — at most 25.
 *
 * POST for a read, for the reason the contacts search is: a name typed here is
 * a client's name and must not sit in a request line. Body: `{ q?: string }`.
 * Nothing about scope comes from the body; it is the verified session's.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const q = (body as { q?: unknown }).q;
  if (q !== undefined && typeof q !== "string") {
    return NextResponse.json({ error: "invalid", fields: ["q"] }, { status: 400, headers: NO_STORE });
  }
  // Without the database there are no Representation contacts to offer.
  if (contactsSource() === "sample") return NextResponse.json({ items: [] }, { headers: NO_STORE });

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    return NextResponse.json({ items: await listEligibleContacts(actor.ctx, q) }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
