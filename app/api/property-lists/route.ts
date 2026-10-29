import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { propertyFailure, propertyListCallerContext, readPropertyBody } from "@/lib/contacts/property-http";
import { createPropertyList, getPropertyLists } from "@/lib/contacts/property-lists-service";
import { readPropertyListsQuery } from "@/lib/contacts/property-lists";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const caller = await propertyListCallerContext(); if (!caller.ok) return caller.response;
    const query = readPropertyListsQuery(new URL(request.url).searchParams); if (!query) return propertyFailure("invalid_property_list");
    const result = await getPropertyLists(caller.ctx, query);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function POST(request: Request) {
  try {
    const caller = await propertyListCallerContext(undefined, true); if (!caller.ok) return caller.response;
    const body = await readPropertyBody(request); if (!body.ok) return propertyFailure("invalid_property_list");
    const result = await createPropertyList(caller.ctx, body.body);
    return result.ok ? NextResponse.json({ list: result.value }, { status: 201, headers: NO_STORE }) : propertyFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
