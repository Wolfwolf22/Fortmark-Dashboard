import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeads } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listContactsPage } from "@/lib/contacts/service";
import { isPaged, parseContactQuery } from "@/lib/contacts/filters";
import { applyQuery } from "@/lib/contacts/windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contacts list — private form.
 *
 * **POST, deliberately, for a read**, for the reason `/api/search` already
 * records: a contacts search string is a client's name, their phone number,
 * their email address. A GET puts that text in the request line, and the
 * request line is what the platform writes to its access logs — so ordinary
 * use of the leads search box would quietly accumulate a log of the
 * brokerage's clients, readable by anyone with project access and retained on
 * someone else's schedule. A POST body is not logged that way. The cost is
 * HTTP caching, which a per-user authorized read refuses anyway.
 *
 * It returns exactly what `GET /api/contacts` returns and enforces exactly the
 * same authorization: the filters it accepts are parsed by the same validator,
 * and ownership and tenancy come from the verified session, never the body.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }

  const record = body as Record<string, unknown>;
  const parsed = parseContactQuery((key) => {
    const value = record[key];
    if (typeof value === "string") return value;
    // Numbers and booleans arrive in a JSON body as themselves.
    return typeof value === "number" || typeof value === "boolean" ? String(value) : null;
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", fields: parsed.fields }, { status: 400, headers: NO_STORE });
  }
  const query = parsed.query;

  if (contactsSource() === "sample") {
    return NextResponse.json(applyQuery(listSampleLeads(), query, new Date()), { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const page = await listContactsPage(actor.ctx, query);
    return NextResponse.json(
      isPaged(query) ? page : { items: page.items, total: page.total },
      { headers: NO_STORE }
    );
  } catch (error) {
    return unexpected(error);
  }
}
