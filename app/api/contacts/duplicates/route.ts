import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, NO_STORE, unexpected } from "@/lib/contacts/http";
import { getContactDuplicateSuggestions } from "@/lib/contacts/duplicates-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only opaque paging state is in the URL; private identifiers stay in the response. */
export async function GET(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (contactsSource() === "sample") return failure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== "cursor" && key !== "pageSize")) return failure("invalid_request");
  const size = params.get("pageSize");
  if (size !== null && !/^\d{1,2}$/.test(size)) return failure("invalid_request");
  try {
    const result = await getContactDuplicateSuggestions(actor.ctx, { cursor: params.get("cursor") ?? undefined, pageSize: size === null ? undefined : Number(size) });
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason);
  } catch (error) { return unexpected(error); }
}
