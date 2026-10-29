import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { getPropertyList, renamePropertyList } from "@/lib/contacts/property-lists-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ listId: string }> }) {
  try {
    const { listId } = await context.params, caller = await propertyListCallerContext(listId); if (!caller.ok) return caller.response;
    const result = await getPropertyList(caller.ctx, listId);
    return result.ok ? NextResponse.json({ list: result.value }, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ listId: string }> }) {
  try {
    const { listId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property_list");
    const result = await renamePropertyList(caller.ctx, listId, body.body);
    return result.ok ? NextResponse.json({ list: result.value }, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
