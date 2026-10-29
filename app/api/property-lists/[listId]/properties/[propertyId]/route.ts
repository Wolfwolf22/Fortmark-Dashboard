import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext } from "@/lib/contacts/property-http";
import { removePropertyListProperty } from "@/lib/contacts/properties-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(_request: Request, context: { params: Promise<{ listId: string; propertyId: string }> }) {
  try {
    const { listId, propertyId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const result = await removePropertyListProperty(caller.ctx, listId, propertyId);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
