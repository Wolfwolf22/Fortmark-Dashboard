import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { profileDatabaseEnabled, sampleDashboardEnabled } from "@/lib/flags";
import {
  fortmarkOfficeConfig,
  officeSyncDue,
  readBrokerage,
  saveBrokerage,
  syncFortmarkOffice,
} from "@/lib/brokerage/service";
import type { BrokerageResponse } from "@/lib/brokerage/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * FortMark's central brokerage identity.
 *
 * GET  every signed-in dashboard user (read-only for most). When the
 *      system-managed MLS section is missing or older than a day it is
 *      refreshed from the configured FortMark office first — at most once a
 *      day, never per request.
 *      `{ source: "sample" }` only in explicit fixture mode with no database.
 * PUT  admin and broker only; operator-owned fields only. A body carrying an
 *      MLS field, a brokerage key, an id or a role is a 400. The tenant is the
 *      caller's, from their session, always.
 */
function failure(reason: string): NextResponse {
  if (reason === "disabled") return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  if (reason === "no_identity") return NextResponse.json({ error: "no_identity" }, { status: 403, headers: NO_STORE });
  if (reason === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}

export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  if (!profileDatabaseEnabled()) {
    if (sampleDashboardEnabled()) return NextResponse.json({ source: "sample" }, { headers: NO_STORE });
    return failure("disabled");
  }
  try {
    let read = await readBrokerage(caller.clerkUserId);
    if (!read.ok) return failure(read.reason);
    if (officeSyncDue(read.identity, fortmarkOfficeConfig())) {
      await syncFortmarkOffice();
      read = await readBrokerage(caller.clerkUserId);
      if (!read.ok) return failure(read.reason);
    }
    const body: BrokerageResponse = {
      identity: read.identity,
      canEdit: read.canEdit,
      officeConfigured: fortmarkOfficeConfig() !== null,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    console.error(`[brokerage] read failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return failure("unavailable");
  }
}

export async function PUT(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  try {
    const saved = await saveBrokerage(caller.clerkUserId, raw);
    if (!saved.ok) {
      if (saved.reason === "invalid") {
        return NextResponse.json(
          { error: "validation_failed", fieldErrors: saved.fieldErrors },
          { status: 400, headers: NO_STORE }
        );
      }
      return failure(saved.reason);
    }
    const body: BrokerageResponse = {
      identity: saved.identity,
      canEdit: true,
      officeConfigured: fortmarkOfficeConfig() !== null,
    };
    return NextResponse.json(body, { status: saved.created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    console.error(`[brokerage] save failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return failure("unavailable");
  }
}
