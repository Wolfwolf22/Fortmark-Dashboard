import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { subsystemAvailability } from "@/lib/subsystems/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which unimplemented subsystems this deployment may show sample data for.
 *
 * The server owns the decision — the fixture flag is server-only — and the
 * browser asks once rather than carrying a second copy of the rule that
 * could drift. The answer is never cached: a deployment that is switched
 * into or out of fixture mode must not be described by a stale response.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  return NextResponse.json(
    { subsystems: subsystemAvailability() },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
