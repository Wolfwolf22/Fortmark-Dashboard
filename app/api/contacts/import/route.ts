import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, NO_STORE, unexpected } from "@/lib/contacts/http";
import { importFailure, readImportBody } from "@/lib/contacts/import-http";
import { commitContactImport } from "@/lib/contacts/import-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (contactsSource() === "sample") return importFailure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  const input = await readImportBody(request); if (!input.ok) return importFailure("invalid_import");
  try {
    const result = await commitContactImport(actor.ctx, input.body);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : importFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
