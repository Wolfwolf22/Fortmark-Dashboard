import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, NO_STORE, unexpected } from "@/lib/contacts/http";
import { mergeContacts } from "@/lib/contacts/merge-service";
import { readImportBody } from "@/lib/contacts/import-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (contactsSource() === "sample") return failure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  const body = await readImportBody(request); if (!body.ok) return failure("invalid_merge");
  try {
    const result = await mergeContacts(actor.ctx, body.body);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason);
  } catch (error) { return unexpected(error); }
}
