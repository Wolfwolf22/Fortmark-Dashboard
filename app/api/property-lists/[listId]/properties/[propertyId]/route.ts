import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { getPropertyListProperty, removePropertyListProperty } from "@/lib/contacts/properties-service";
import { updatePropertyResearch } from "@/lib/contacts/property-research-service";
import { propertyRemovalInputSchema } from "@/lib/contacts/property-research";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ listId: string; propertyId: string }> }) {
  try {
    const { listId, propertyId } = await context.params, caller = await propertyListCallerContext(listId); if (!caller.ok) return caller.response;
    const result = await getPropertyListProperty(caller.ctx, listId, propertyId);
    return result.ok ? NextResponse.json({ property: result.value }, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ listId: string; propertyId: string }> }) {
  try {
    const { listId, propertyId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property_research");
    const result = await updatePropertyResearch(caller.ctx, listId, propertyId, body.body);
    return result.ok ? NextResponse.json({ property: result.value }, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ listId: string; propertyId: string }> }) {
  try {
    const { listId, propertyId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    let input: unknown = {};
    if (request.body && request.headers.get("content-length") !== "0") { const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property_research"); input = body.body; }
    const parsed = propertyRemovalInputSchema.safeParse(input); if (!parsed.success) return propertyFailure("invalid_property_research");
    const result = await removePropertyListProperty(caller.ctx, listId, propertyId, new Date(), parsed.data.expectedUpdatedAt);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
