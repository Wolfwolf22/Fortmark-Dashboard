import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  AI_EFFORT,
  AI_MAX_TOKENS,
  AI_MODEL,
  AI_SYSTEM_PROMPT,
  parseChatRequest,
  resolveAiCredential,
  type ChatTurn,
} from "@/lib/ai/provider";
import { runAssistant, type OpenedRound, type RoundOpener, type Turn } from "@/lib/ai/loop";
import type { ProviderEvent } from "@/lib/ai/stream";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/registry";
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
 * The model never touches infrastructure. It has no database URL, no MLS
 * credential and no API key; it emits the name of a tool, and this server
 * decides whether to run it, under whose identity, and what comes back.
 *
 * There is no mock path. An environment without a provider key says so
 * (503 `not_configured`) rather than serving a generated reply — the old
 * fallback opened with an invented comp table, which is the last thing a
 * pricing conversation should be able to produce.
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

  const credential = resolveAiCredential();
  if (!credential.ok) {
    return NextResponse.json(
      { error: "not_configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  // `userId` is non-null here: `decideAccess` refused every anonymous case.
  return providerResponse(parsed.messages, userId as string, credential.apiKey, request.signal);
}

/**
 * The real model call.
 *
 * The first round is opened — and its first event awaited — before a
 * `Response` is returned. Once a 200 and its headers are on the wire the
 * status can no longer be corrected, so a failure that happens up front (a
 * rejected key, a rate limit, an overloaded model) would otherwise reach the
 * browser as an empty but apparently successful stream. Waiting costs the
 * first event's latency and buys an accurate status code for every error that
 * occurs before generation starts.
 */
async function providerResponse(
  messages: ChatTurn[],
  clerkUserId: string,
  apiKey: string,
  signal: AbortSignal
): Promise<Response> {
  const client = new Anthropic({ apiKey });
  const tools = toolParams();

  // The round currently generating. A turn may span several, and cancelling
  // must stop the one that is running — not the first one, which finished
  // rounds ago and would leave a live generation nobody will read.
  let active: { abort: () => void } = { abort: () => {} };

  const open: RoundOpener = async (turns, options) => {
    const stream = client.beta.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: turns,
        tools,
        // The last round is opened unable to ask for anything more, so the
        // turn ends in an answer rather than in a request nobody can pay for.
        tool_choice: options.allowTools ? { type: "auto" } : { type: "none" },
        output_config: { effort: AI_EFFORT },
        // Thinking is on by default on this model and its text is not
        // returned. Only `text_delta` is forwarded downstream, so reasoning
        // can never be streamed into the thread as though it were the answer.
        //
        // On a policy decline the API re-runs the request on a fallback model
        // inside the same call, routed by refusal category. Without it a
        // declined request simply stops, which in a chat surface is an
        // unexplained blank reply.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      // Forwards a client disconnect to the provider. Without it, closing the
      // thread leaves a generation running that nobody will read and everybody
      // pays for.
      { signal }
    );
    active = { abort: () => stream.abort() };
    return {
      iterator: stream[Symbol.asyncIterator]() as AsyncIterator<ProviderEvent>,
      abort: () => stream.abort(),
    };
  };

  let first: OpenedRound;
  let primed: PrimedIterator;
  try {
    first = await open(messages as Turn[], { allowTools: true });
    primed = await prime(first.iterator);
  } catch (error) {
    return providerError(error);
  }
  if (!primed.ok) {
    // Nothing has been sent yet, so the status is still ours to choose.
    first.abort();
    return providerError(primed.error);
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

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of runAssistant(
          messages as Turn[],
          { iterator: primed.iterator, abort: first.abort },
          ctx,
          open
        )) {
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

type PrimedIterator =
  | { ok: false; error: unknown }
  | { ok: true; iterator: AsyncIterator<ProviderEvent> };

/**
 * Pull the first event, then hand back an iterator that starts with it.
 *
 * This is what makes the status code trustworthy. With tools in play the first
 * thing a turn produces may be a tool call rather than text, so waiting for
 * text would drain an entire round before deciding on a status — and a turn
 * that legitimately opens with a lookup would be reported as empty.
 */
async function prime(iterator: AsyncIterator<ProviderEvent>): Promise<PrimedIterator> {
  let head: IteratorResult<ProviderEvent>;
  try {
    head = await iterator.next();
  } catch (error) {
    return { ok: false, error };
  }
  let replayed = false;
  return {
    ok: true,
    iterator: {
      async next() {
        if (!replayed) {
          replayed = true;
          return head;
        }
        return iterator.next();
      },
    },
  };
}

/**
 * The tools, as the provider sees them.
 *
 * Deliberately NOT sent with `strict: true`. Strict mode constrains which
 * JSON Schema keywords a tool may declare, and these schemas carry length,
 * range and item bounds that guide the model well; a keyword the provider
 * refuses is a 400 on every turn, which is a total outage of the surface. The
 * enforcement that matters does not live there anyway — every argument is
 * re-parsed against the very same schema in `executeTool` before a service is
 * reached, and an argument that fails comes back as `invalid_arguments`. The
 * provider-side check would only have saved the occasional wasted round.
 *
 * Worth turning on once a deployment with a live key can prove the schemas
 * are accepted. It is not worth guessing at.
 */
function toolParams(): Anthropic.Beta.BetaToolUnion[] {
  return READ_ONLY_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
  }));
}

/**
 * Map a provider failure onto a status, without forwarding its message.
 *
 * The SDK's typed classes are matched most specific first. A bad key is ours
 * to fix and is reported as a server fault, never as the caller's.
 */
function providerError(error: unknown): NextResponse {
  if (error instanceof Anthropic.APIUserAbortError) {
    // The caller hung up before the first event. Nothing to report.
    return NextResponse.json({ error: "Cancelled" }, { status: 499, headers: NO_STORE });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return NextResponse.json({ error: "Busy" }, { status: 429, headers: NO_STORE });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error(
      "[ai] the provider rejected ANTHROPIC_API_KEY. Chat is unavailable until a valid key is set."
    );
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (error instanceof Anthropic.BadRequestError) {
    // A request this route built and the provider refused: ours, not theirs.
    console.error("[ai] the provider rejected the request shape built by this route.");
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (error instanceof Anthropic.APIError) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}
