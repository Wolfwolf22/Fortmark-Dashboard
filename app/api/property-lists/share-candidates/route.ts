import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext } from "@/lib/contacts/property-http";
import { getPropertyListShareCandidates } from "@/lib/contacts/property-lists-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const caller = await propertyListCallerContext(undefined, true); if (!caller.ok) return caller.response;
    const params = new URL(request.url).searchParams, raw = params.get("page") ?? "1";
    if ([...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1 || !/^\d{1,5}$/.test(raw)) return propertyFailure("invalid_property_list");
    const result = await getPropertyListShareCandidates(caller.ctx, Number(raw)); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
