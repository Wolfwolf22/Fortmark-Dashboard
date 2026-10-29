import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyCallerContext, propertyFailure } from "@/lib/contacts/property-http";
import { removeContactProperty } from "@/lib/contacts/properties-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; propertyId: string }> }) {
  try {
    const { id, propertyId } = await context.params;
    const caller = await propertyCallerContext(id, true);
    if (!caller.ok) return caller.response;
    const result = await removeContactProperty(caller.ctx, id, propertyId);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
