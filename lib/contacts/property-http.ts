import "server-only";
import { NextResponse } from "next/server";
import { requireCaller } from "../auth/require-caller.ts";
import { isRecordId } from "../db/ids.ts";
import { loadContact } from "./access.ts";
import { actorOrResponse, contactsSource, failure, NO_STORE } from "./http.ts";
import { PROPERTY_BODY_BYTES } from "./properties.ts";
import type { PropertyFailure } from "./properties-service.ts";
import type { Ctx } from "./service.ts";
import { loadPropertyList } from "./property-lists-service.ts";

/** Settle the parent scope before even creating the provider, which may resolve feed identity. */
export async function propertyCallerContext(contactId: string, write: boolean): Promise<{ ok: true; ctx: Ctx; clerkUserId: string } | { ok: false; response: NextResponse }> {
  const caller = await requireCaller();
  if (!caller.ok) return caller;
  if (!isRecordId(contactId) || contactsSource() === "sample") return { ok: false, response: failure("not_found") };
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor;
  const parent = await loadContact(actor.ctx, contactId);
  if (!parent.ok) return { ok: false, response: failure(parent.reason) };
  if (write && !parent.writable) return { ok: false, response: failure("forbidden") };
  return { ok: true, ctx: actor.ctx, clerkUserId: caller.clerkUserId };
}

/** Named lists are owner-private, even when the contact would be admin-visible. */
export async function propertyListCallerContext(listId?: string, write = false): Promise<{ ok: true; ctx: Ctx; clerkUserId: string } | { ok: false; response: NextResponse }> {
  const caller = await requireCaller(); if (!caller.ok) return caller;
  if (contactsSource() === "sample") return { ok: false, response: failure("not_found") };
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor;
  if (write && actor.ctx.actor.role === "member") return { ok: false, response: failure("forbidden") };
  if (listId !== undefined) {
    const list = await loadPropertyList(actor.ctx, listId); if (!list.ok) return { ok: false, response: propertyFailure(list.reason) };
    if (write && !list.value.writable) return { ok: false, response: failure("forbidden") };
  }
  return { ok: true, ctx: actor.ctx, clerkUserId: caller.clerkUserId };
}

/** Lookup/add bodies contain only bounded identifiers; listing snapshots are never accepted. */
export async function readPropertyBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > PROPERTY_BODY_BYTES) return { ok: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > PROPERTY_BODY_BYTES) { await reader.cancel(); return { ok: false }; }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined)) };
  } catch { return { ok: false }; }
}

export function propertyFailure(reason: PropertyFailure): NextResponse {
  switch (reason) {
    case "invalid_share_recipient": case "list_in_use": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "invalid_property_research": return NextResponse.json({ error: reason, fields: ["notes", "reviewStatus"] }, { status: 400, headers: NO_STORE });
    case "invalid_property_transfer": return NextResponse.json({ error: reason, fields: ["targetListId"] }, { status: 400, headers: NO_STORE });
    case "target_has_property": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "invalid_property_list": return NextResponse.json({ error: "invalid_property_list", fields: ["name"] }, { status: 400, headers: NO_STORE });
    case "invalid_property": return NextResponse.json({ error: "invalid_property", fields: ["mlsNumber"] }, { status: 400, headers: NO_STORE });
    case "listing_not_found": return NextResponse.json({ error: "listing_not_found" }, { status: 404, headers: NO_STORE });
    case "ambiguous": case "listing_changed": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "not_configured": return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
    default: return failure(reason);
  }
}
