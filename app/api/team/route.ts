import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { profileDatabaseEnabled, sampleDashboardEnabled } from "@/lib/flags";
import { listTeam } from "@/lib/team/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * The brokerage roster.
 *
 *   db              real dashboard users and their professional profiles.
 *   sample          explicit fixture mode only; the screen labels it.
 *   not_configured  no profile database and no fixture mode — a 503 that the
 *                   screen renders as "not configured", never an empty team.
 *
 * The server decides which one; the client never chooses its own source.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  if (!profileDatabaseEnabled()) {
    if (sampleDashboardEnabled()) {
      return NextResponse.json({ source: "sample" }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await listTeam(caller.clerkUserId);
    if (!result.ok) {
      const status = result.reason === "no_identity" ? 403 : 503;
      return NextResponse.json(
        { error: status === 403 ? "no_identity" : "Service unavailable" },
        { status, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { source: "db", viewerPrivileged: result.viewerPrivileged, items: result.items },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error(`[team] unexpected failure${error instanceof Error ? `: ${error.name}` : ""}`);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}
