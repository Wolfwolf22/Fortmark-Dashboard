import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { parseChatRequest, type ChatTurn } from "@/lib/ai/provider";
import { runAssistant } from "@/lib/ai/loop";
import { resolveProvider } from "@/lib/ai/providers/select";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import { openaiProvider } from "@/lib/ai/providers/openai";
import type {
  AiProvider,
  NeutralTurn,
  OpenedRound,
  ProviderFailureKind,
} from "@/lib/ai/providers/types";
import type { ToolContext } from "@/lib/ai/tools/types";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";

export const runtime = "nodejs";

/** Per-user output; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * A tool round trip costs a model call plus a database round trip, and a
 * considered answer may take several. Streaming does not exempt a function
 * from the platform ceiling — the response is cut off mid-sentence when it
 * expires — so it is raised here rather than discovered later as a truncation
 * that looks like a model fault.
 */
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Headers for the incremental plain-text stream `lib/ai/client.ts` consumes. */
const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  // FortMark content tied to one user — never shared or stored by a cache.
  "Cache-Control": "private, no-store",
  // Proxies that buffer a response would defeat streaming entirely.
  "X-Accel-Buffering": "no",
} as const;

/**
 * The assistant, over this caller's real records.
 *
 * Authorization is enforced here as well as in `middleware.ts`: a route
 * handler is the last line of defence for the data it returns, and must not
 * depend on a matcher pattern staying correct. The verified Clerk user id is
 * the *only* thing that decides what the tools can read; nothing about
 * identity, tenancy, ownership or role is accepted from the request body, and
 * no tool has an argument that could carry one.
 *
 * Which vendor answers is resolved server-side from `AI_PROVIDER` and is
 * likewise never influenced by the request. The model — either model — never
 * touches infrastructure: it has no database URL, no MLS credential and no API
 * key. It emits the name of a tool, and this server decides whether to run it,
 * under whose identity, and what comes back.
 *
 * There is no mock path and no cross-vendor fallback. An environment that
 * cannot reach its selected provider says so (503 `not_configured`) rather
 * than answering with the other one or with a generated reply.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  const decision = decideAccess(userId);
  if (!decision.ok) {
    // 503 for a broken server config, 401 for anonymous, 403 for a signed-in
    // but unapproved user. The reason is coarse and content-free.
    const status = isConfigFailure(decision.reason)
      ? 503
      : decision.reason === "not_signed_in"
        ? 401
        : 403;
    return NextResponse.json(
      { error: status === 503 ? "Service unavailable" : "Forbidden" },
      { status, headers: NO_STORE }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }

  const parsed = parseChatRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too_large" ? "Message too long" : "Malformed request" },
      { status: parsed.reason === "too_large" ? 413 : 400, headers: NO_STORE }
    );
  }

  const selection = resolveProvider();
  if (!selection.ok) {
    if (selection.reason === "invalid_provider") {
      console.error("[ai] AI_PROVIDER is set to a value this build does not implement.");
    }
    return NextResponse.json(
      { error: "not_configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  // `userId` is non-null here: `decideAccess` refused every anonymous case.
  const provider =
    selection.name === "openai"
      ? openaiProvider(selection.apiKey, selection.model, request.signal)
      : anthropicProvider(selection.apiKey, selection.model, request.signal);

  // The adapter already holds the request's abort signal: a disconnect is
  // forwarded to whichever vendor is generating.
  return providerResponse(parsed.messages, userId as string, provider);
}

/**
 * The real model call.
 *
 * The first round is opened — and its first wire event awaited, inside the
 * adapter — before a `Response` is returned. Once a 200 and its headers are on
 * the wire the status can no longer be corrected, so a failure that happens up
 * front (a rejected key, a rate limit, an overloaded model) would otherwise
 * reach the browser as an empty but apparently successful stream. Waiting
 * costs the first event's latency and buys an accurate status code for every
 * error that occurs before generation starts.
 *
 * Nothing below this point knows which vendor is answering, and nothing above
 * the adapters has ever known.
 */
async function providerResponse(
  messages: ChatTurn[],
  clerkUserId: string,
  provider: AiProvider
): Promise<Response> {
  const history: NeutralTurn[] = messages.map((message) =>
    message.role === "user"
      ? { role: "user", text: message.content }
      : { role: "assistant", text: message.content, toolCalls: [] }
  );

  let first: OpenedRound;
  try {
    first = await provider.openRound(history, { allowTools: true });
  } catch (error) {
    return providerError(provider, error);
  }

  // Correlates this turn's rounds and tool calls in the log. Random, never
  // derived from the caller or their message, and never persisted.
  const ctx: ToolContext = {
    clerkUserId,
    env: process.env,
    now: new Date(),
    traceId: randomUUID().slice(0, 8),
  };
  const encoder = new TextEncoder();

  // The round currently generating. A turn may span several, and cancelling
  // must stop the one that is running — not the first one, which finished
  // rounds ago and would leave a live generation nobody will read.
  let active: OpenedRound = first;
  const tracked: Pick<AiProvider, "openRound"> = {
    openRound: async (turns, options) => {
      active = await provider.openRound(turns, options);
      return active;
    },
  };

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of runAssistant(history, first, ctx, tracked)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The reader went away; stop whichever round is generating now.
      active.abort();
    },
  });

  return new Response(readable, { headers: STREAM_HEADERS });
}

/**
 * Map a provider failure onto a status, without forwarding its message.
 *
 * The adapter classifies its own SDK's error — vendor error classes never
 * reach this file — and a bad key is ours to fix and is reported as a server
 * fault, never as the caller's.
 */
function providerError(provider: AiProvider, error: unknown): NextResponse {
  const kind: ProviderFailureKind = provider.classify(error);
  switch (kind) {
    case "cancelled":
      // The caller hung up before the first event. Nothing to report.
      return NextResponse.json({ error: "Cancelled" }, { status: 499, headers: NO_STORE });
    case "rate_limited":
      return NextResponse.json({ error: "Busy" }, { status: 429, headers: NO_STORE });
    case "auth":
      console.error(
        `[ai] the ${provider.name} provider rejected its API key. Chat is unavailable until a valid key is set.`
      );
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
    case "bad_request":
      // A request this route built and the provider refused: ours, not theirs.
      console.error(`[ai] the ${provider.name} provider rejected the request shape built by this route.`);
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
    default:
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}
