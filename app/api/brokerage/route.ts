import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { profileDatabaseEnabled, sampleDashboardEnabled } from "@/lib/flags";
import { readBrokerage, saveBrokerage } from "@/lib/brokerage/service";
import type { BrokerageResponse, MlsOfficeView } from "@/lib/brokerage/identity";
import { mlsConfig } from "@/lib/mls/http";
import { getMlsOffice } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Brokerage identity for the caller's own brokerage.
 *
 * GET  every signed-in dashboard user of the brokerage (read-only for most).
 *      `{ source: "sample" }` only in explicit fixture mode with no database.
 * PUT  admin and broker only. The body carries brokerage fields and nothing
 *      else — a brokerage key, id or role in it is a 400. The tenant is the
 *      caller's, from their session, always.
 */
function failure(reason: string): NextResponse {
  if (reason === "disabled") {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (reason === "no_identity") {
    return NextResponse.json({ error: "no_identity" }, { status: 403, headers: NO_STORE });
  }
  if (reason === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}

/** The MLS's own view of the configured office. Supplement only; never fatal. */
async function mlsOfficeFor(officeId: string | null, signal: AbortSignal): Promise<MlsOfficeView | null> {
  if (!officeId) return null;
  const config = mlsConfig();
  if (!config.ok) return null;
  try {
    return await getMlsOffice(config.config, officeId, signal);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  // No database: the labelled fixture in explicit sample mode, else "not
  // configured". The server decides; the client never picks its own source.
  if (!profileDatabaseEnabled()) {
    if (sampleDashboardEnabled()) return NextResponse.json({ source: "sample" }, { headers: NO_STORE });
    return failure("disabled");
  }
  try {
    const read = await readBrokerage(caller.clerkUserId);
    if (!read.ok) return failure(read.reason);
    const body: BrokerageResponse = {
      identity: read.identity,
      canEdit: read.canEdit,
      mlsOffice: await mlsOfficeFor(read.identity?.mlsOfficeId ?? null, request.signal),
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
      mlsOffice: await mlsOfficeFor(saved.identity.mlsOfficeId, request.signal),
    };
    return NextResponse.json(body, { status: saved.created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    console.error(`[brokerage] save failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return failure("unavailable");
  }
}
