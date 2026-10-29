import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyCallerContext, propertyFailure, readPropertyBody } from "@/lib/contacts/property-http";
import { lookupContactProperty } from "@/lib/contacts/properties-service";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const caller = await propertyCallerContext(id, true);
    if (!caller.ok) return caller.response;
    const parsed = await readPropertyBody(request);
    if (!parsed.ok) return propertyFailure("invalid_property");
    const provider = await createContactPropertyMlsProvider(caller.clerkUserId, request.signal);
    const result = await lookupContactProperty(caller.ctx, id, parsed.body, provider);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
