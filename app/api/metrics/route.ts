import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { brokerageMetrics } from "@/lib/metrics/service";
import { sampleBrokerageMetrics } from "@/lib/data/sample-metrics";
import { sampleDashboardEnabled } from "@/lib/flags";
import type { BrokerageMetrics } from "@/lib/metrics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Fixture mode applies only where there is nothing real to report.
 *
 * `not_configured` means this deployment has no such source connected — that
 * is the one state a demo may stand in for. `unavailable` means a configured
 * source failed, and substituting invented numbers there would be exactly the
 * silent fallback this architecture exists to prevent: the screen would show a
 * healthy brokerage while the database was unreachable. So a failure stays a
 * failure, whatever the flag says.
 */
function mayServeSample(metrics: BrokerageMetrics): boolean {
  return (
    metrics.transactions.availability === "not_configured" &&
    metrics.contacts.availability === "not_configured"
  );
}

/**
 * The brokerage's numbers for the signed-in caller.
 *
 * Scoped by the same actor rules as the records themselves: an agent's
 * dashboard aggregates an agent's book. Nothing about who is asking comes
 * from the request.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const metrics = await brokerageMetrics(caller.clerkUserId);
  if (sampleDashboardEnabled() && mayServeSample(metrics)) {
    return NextResponse.json(sampleBrokerageMetrics(), { headers: NO_STORE });
  }
  return NextResponse.json(metrics, { headers: NO_STORE });
}
