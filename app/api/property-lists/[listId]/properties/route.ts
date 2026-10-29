import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { getPropertyListProperties, addPropertyListProperty } from "@/lib/contacts/properties-service";
import { readPropertyQuery } from "@/lib/contacts/properties";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ listId: string }> }) {
  try {
    const { listId } = await context.params, caller = await propertyListCallerContext(listId); if (!caller.ok) return caller.response;
    const query = readPropertyQuery(new URL(request.url).searchParams); if (!query) return propertyFailure("invalid_property");
    const result = await getPropertyListProperties(caller.ctx, listId, await createContactPropertyMlsProvider(caller.clerkUserId, request.signal), query);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function POST(request: Request, context: { params: Promise<{ listId: string }> }) {
  try {
    const { listId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property");
    const result = await addPropertyListProperty(caller.ctx, listId, body.body, await createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json({ property: result.value }, { status: 201, headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
