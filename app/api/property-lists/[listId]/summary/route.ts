import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext } from "@/lib/contacts/property-http";
import { getPropertyListSummary } from "@/lib/contacts/property-list-summary-service";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ listId: string }> }) {
  try { const { listId } = await context.params, caller = await propertyListCallerContext(listId); if (!caller.ok) return caller.response;
    if (new URL(request.url).search) return propertyFailure("invalid_property_list");
    const result = await getPropertyListSummary(caller.ctx, listId, await createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
