import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead } from "@/lib/data/sample-leads";
import { editContactSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { editContact, getContact } from "@/lib/contacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One contact. Out of scope is answered exactly like non-existent. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if (contactsSource() === "sample") {
    const lead = getSampleLead(id);
    return lead
      ? NextResponse.json({ contact: lead }, { headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const contact = await getContact(actor.ctx, id);
    if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ contact }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}

/**
 * Edit a contact's details: name, email, phone, company, source, notes.
 *
 * Out of scope is 404 and read-only is 403, both before the body's content is
 * judged. Ownership, stage, dates and identifiers are not editable here — a body
 * that names one is refused (400), not quietly ignored. Field names only in an
 * error, never what was typed.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  // The sample set is edited in the browser by the adapter.
  if (contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = editContactSchema.safeParse(body);
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join(".") || "body")));
    return NextResponse.json({ error: "invalid", fields }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await editContact(actor.ctx, id, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value.lead, changed: result.value.changed }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
