import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { NO_STORE, transactionsSource } from "@/lib/transactions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which source the transactions screen is on.
 *
 * The server owns the decision (the flag is server-only) and the browser asks
 * once. In `sample` mode the adapter serves rows locally so quick-create and
 * drag-to-advance keep working in memory; in `db` mode every read and write
 * goes through the routes.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  return NextResponse.json({ source: transactionsSource() }, { headers: NO_STORE });
}
