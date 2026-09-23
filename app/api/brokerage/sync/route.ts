import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { resolveActor } from "@/lib/auth/actor";
import { profileDatabaseEnabled } from "@/lib/flags";
import { canEditBrokerage } from "@/lib/brokerage/identity";
import { readBrokerage, syncFortmarkOffice } from "@/lib/brokerage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST — refresh FortMark's MLS office section now (admin and broker). Reads
 * the configured office's Office record; writes only system-managed columns.
 */
export async function POST() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const actor = await resolveActor(caller.clerkUserId, profileDatabaseEnabled());
  if (!actor.ok) {
    return NextResponse.json(
      { error: actor.reason === "no_identity" ? "no_identity" : "not_configured" },
      { status: actor.reason === "no_identity" ? 403 : 503, headers: NO_STORE }
    );
  }
  if (!canEditBrokerage(actor.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const result = await syncFortmarkOffice({ actorUserId: actor.actor.userId });
  const read = await readBrokerage(caller.clerkUserId);
  return NextResponse.json(
    { sync: result.status, identity: read.ok ? read.identity : null },
    { status: result.status === "synced" ? 200 : result.status === "unavailable" ? 503 : 409, headers: NO_STORE }
  );
}
