import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeads } from "@/lib/data/sample-leads";
import { createContactSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContact, listContactsPage } from "@/lib/contacts/service";
import { isPaged, parseContactQuery } from "@/lib/contacts/filters";
import { applyQuery } from "@/lib/contacts/windows";

export const runtime = "nodejs";

/** Per-user, confidential; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * The GET path never reads `q`.
 *
 * A search string is a client's name, their phone number, their email. A GET
 * puts it in the request line and the request line is what the platform
 * writes to its access logs, so searching from this screen would quietly
 * accumulate a log of the brokerage's clients. Text goes to the POST search
 * route instead; a stage, a source or a follow-up filter is not identifying and
 * stays here.
 *
 * An invalid filter is refused (400, naming the parameter — never the value)
 * rather than ignored: `?stage=garbage` must not become "every contact".
 */
function parseUrlQuery(params: URLSearchParams) {
  return parseContactQuery((key) => (key === "q" ? null : params.get(key)));
}

/**
 * The caller's contacts that match — filtered, sorted and (with `page` /
 * `pageSize`) paged in the database. `total` is the match count.
 */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const parsed = parseUrlQuery(request.nextUrl.searchParams);
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

/** Add a person. Ownership and tenancy are the server's; see the schema. */
export async function POST(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  if (contactsSource() === "sample") {
    // The sample set is written in the browser's memory, not through here.
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    // Field paths only — never the submitted values.
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join("."))));
    return NextResponse.json({ error: "invalid", fields }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await createContact(actor.ctx, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
