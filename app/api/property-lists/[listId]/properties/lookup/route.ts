import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { lookupPropertyListProperty } from "@/lib/contacts/properties-service";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ listId: string }> }) {
  try {
    const { listId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property");
    const result = await lookupPropertyListProperty(caller.ctx, listId, body.body, await createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
