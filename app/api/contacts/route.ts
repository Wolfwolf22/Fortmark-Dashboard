import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleLeads } from "@/lib/data/sample-leads";
import type { LeadSource, LeadStage } from "@/lib/data/types";
import { createContactSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContact, listContacts } from "@/lib/contacts/service";
import { ALL_CONTACT_STAGES } from "@/lib/contacts/stages";

export const runtime = "nodejs";

/** Per-user, confidential; never cached or statically generated. */
export const dynamic = "force-dynamic";

const SOURCES: readonly LeadSource[] = ["referral", "sphere", "sign_call", "website", "open_house", "past_client", "social", "advertising", "walk_in", "other"];

function parseFilters(params: URLSearchParams) {
  const list = <T extends string>(raw: string | null, allowed: readonly T[]) => {
    if (!raw) return undefined;
    const picked = raw.split(",").map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s));
    return picked.length ? picked : undefined;
  };
  const q = params.get("q")?.trim().slice(0, 120);
  const agent = params.get("agent")?.trim();
  return {
    stage: list(params.get("stage"), ALL_CONTACT_STAGES as readonly LeadStage[]),
    source: list(params.get("source"), SOURCES),
    agentId: agent && /^[A-Za-z0-9-]{1,64}$/.test(agent) ? agent : undefined,
    query: q && q.length > 0 ? q : undefined,
  };
}

/** The caller's contacts — every one they may see. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const filters = parseFilters(request.nextUrl.searchParams);

  if (contactsSource() === "sample") {
    return NextResponse.json({ items: listSampleLeads(filters) }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const items = await listContacts(actor.ctx, filters);
    return NextResponse.json({ items }, { headers: NO_STORE });
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
