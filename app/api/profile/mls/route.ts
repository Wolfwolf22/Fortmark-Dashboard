import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/auth/require-caller";
import { resolveActor } from "@/lib/auth/actor";
import { profileDatabaseEnabled } from "@/lib/flags";
import { getDb } from "@/lib/db/client";
import { dashboardUsers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readOwnMlsIdentity, resolveIfLicenceChanged, resolveMlsIdentity } from "@/lib/mls-identity/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * The caller's MLS identity (licence → MLS member → FortMark office).
 *
 * GET   the caller's own state. If the profile's licence has never been
 *       matched (or changed), it is matched once here — not on every read.
 * POST  an explicit refresh. `{}` refreshes the caller; `{ userId }` refreshes
 *       another FortMark user and is honoured for admin and broker only. The
 *       target must be an existing dashboard user — the roster never creates
 *       accounts.
 */
function failure(reason: string) {
  if (reason === "disabled") return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  if (reason === "no_identity") return NextResponse.json({ error: "no_identity" }, { status: 403, headers: NO_STORE });
  if (reason === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}

export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  try {
    const actor = await resolveActor(caller.clerkUserId, profileDatabaseEnabled());
    if (!actor.ok) return failure(actor.reason);
    await resolveIfLicenceChanged(actor.actor.userId);
    const read = await readOwnMlsIdentity(caller.clerkUserId);
    if (!read.ok) return failure(read.reason);
    return NextResponse.json({ identity: read.view }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[mls-identity] read failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return failure("unavailable");
  }
}

const refreshSchema = z.object({ userId: z.string().uuid().optional() }).strict();

export async function POST(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const parsed = refreshSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });

  try {
    const actor = await resolveActor(caller.clerkUserId, profileDatabaseEnabled());
    if (!actor.ok) return failure(actor.reason);
    const target = parsed.data.userId ?? actor.actor.userId;
    if (target !== actor.actor.userId) {
      if (actor.actor.role !== "admin" && actor.actor.role !== "broker") return failure("forbidden");
      const db = getDb();
      const exists = db
        ? (await db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(eq(dashboardUsers.id, target)).limit(1))[0]
        : null;
      if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    const outcome = await resolveMlsIdentity(target, { actorUserId: actor.actor.userId });
    if (target !== actor.actor.userId) {
      return NextResponse.json({ state: outcome.state }, { headers: NO_STORE });
    }
    const read = await readOwnMlsIdentity(caller.clerkUserId);
    if (!read.ok) return failure(read.reason);
    return NextResponse.json({ identity: read.view }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[mls-identity] refresh failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return failure("unavailable");
  }
}
