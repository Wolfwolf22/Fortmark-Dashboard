import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleTransactions } from "@/lib/data/sample-transactions";
import type { TransactionFilters, TransactionSide, TransactionStage } from "@/lib/data/types";
import { createTransactionSchema } from "@/lib/transactions/domain";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { createTransaction, listTransactions } from "@/lib/transactions/service";
import { ALL_STAGES } from "@/lib/transactions/stages";

export const runtime = "nodejs";

/** Per-user, confidential; never cached or statically generated. */
export const dynamic = "force-dynamic";

const SIDES: readonly TransactionSide[] = ["listing", "buyer", "dual", "landlord", "tenant"];

function parseFilters(params: URLSearchParams): { filters: TransactionFilters; range?: { from: Date; to: Date } } {
  const list = <T extends string>(raw: string | null, allowed: readonly T[]) => {
    if (!raw) return undefined;
    const picked = raw.split(",").map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s));
    return picked.length ? picked : undefined;
  };
  const q = params.get("q")?.trim().slice(0, 120);
  const filters: TransactionFilters = {
    stage: list(params.get("stage"), ALL_STAGES as readonly TransactionStage[]),
    side: list(params.get("side"), SIDES),
    query: q && q.length > 0 ? q : undefined,
  };
  const from = params.get("from");
  const to = params.get("to");
  let range: { from: Date; to: Date } | undefined;
  if (from && to) {
    const f = new Date(from);
    const t = new Date(to);
    if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && f <= t) range = { from: f, to: t };
  }
  return { filters, range };
}

/** The caller's deals — every one they may see, within the optional period. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { filters, range } = parseFilters(request.nextUrl.searchParams);

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
