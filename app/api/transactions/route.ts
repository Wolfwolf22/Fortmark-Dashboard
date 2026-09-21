import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleTransactions } from "@/lib/data/sample-transactions";
import { createTransactionSchema } from "@/lib/transactions/domain";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { createTransaction, listTransactions } from "@/lib/transactions/service";
import { parseTransactionFilters } from "@/lib/transactions/filters";

export const runtime = "nodejs";

/** Per-user, confidential; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * The GET path never reads `q`.
 *
 * A deal search term is a property address — the one a named client is buying.
 * A GET would write it into the platform's access logs on every keystroke, so
 * text goes to the POST search route instead. Stage, side and the date window
 * are not identifying and stay here.
 */
function parseUrlFilters(params: URLSearchParams) {
  return parseTransactionFilters((key) => (key === "q" ? null : params.get(key)));
}

/** The caller's deals — every one they may see, within the optional period. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { filters, range } = parseUrlFilters(request.nextUrl.searchParams);

  if (transactionsSource() === "sample") {
    return NextResponse.json({ items: listSampleTransactions(filters, range) }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const items = await listTransactions(actor.ctx, filters, range);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}

/** Open a deal. Ownership and tenancy are the server's; see the schema. */
export async function POST(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  if (transactionsSource() === "sample") {
    // The sample set is written in the browser's memory, not through here.
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    // Field paths only — never the submitted values.
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join("."))));
    return NextResponse.json({ error: "invalid", fields }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await createTransaction(actor.ctx, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ transaction: result.value }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
