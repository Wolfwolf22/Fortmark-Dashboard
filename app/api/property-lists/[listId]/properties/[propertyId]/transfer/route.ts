import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { transferProperty } from "@/lib/contacts/property-research-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ listId: string; propertyId: string }> }) {
  try {
    const { listId, propertyId } = await context.params, caller = await propertyListCallerContext(listId, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property_transfer");
    const result = await transferProperty(caller.ctx, listId, propertyId, body.body);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
