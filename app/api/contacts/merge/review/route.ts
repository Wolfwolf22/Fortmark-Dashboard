import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, NO_STORE, unexpected } from "@/lib/contacts/http";
import { getContactMergeReview } from "@/lib/contacts/merge-service";
import { readImportBody } from "@/lib/contacts/import-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ primaryId: z.string().uuid(), duplicateId: z.string().uuid() }).strict();
export async function POST(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (contactsSource() === "sample") return failure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  const body = await readImportBody(request); if (!body.ok) return failure("invalid_merge");
  const parsed = inputSchema.safeParse(body.body); if (!parsed.success) return failure("invalid_merge");
  try {
    const result = await getContactMergeReview(actor.ctx, parsed.data.primaryId, parsed.data.duplicateId);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason);
  } catch (error) { return unexpected(error); }
}
