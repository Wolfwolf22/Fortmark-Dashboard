import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import { mockReplyFor } from "@/lib/ai/mock-response";
import {
  AI_EFFORT,
  AI_MAX_TOKENS,
  AI_MODEL,
  AI_SYSTEM_PROMPT,
  parseChatRequest,
  resolveAiCredential,
  type ChatTurn,
} from "@/lib/ai/provider";
import { EMPTY_TURN_TEXT, openTextStream, remainingText } from "@/lib/ai/stream";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";

export const runtime = "nodejs";

/** Per-user output; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * Vercel's default function ceiling is far shorter than a considered reply.
 * Streaming does not exempt a function from it — the response is cut off
 * mid-sentence when it expires — so it is raised here rather than discovered
 * later as a truncation that looks like a model fault.
 */
export const maxDuration = 60;

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
 * Streaming chat endpoint.
 *
 * Authorization is enforced here as well as in `middleware.ts`: a route
 * handler is the last line of defence for the data it returns, and must not
 * depend on a matcher pattern staying correct.
 *
 * The provider is reached only when `AI_CHAT_PROVIDER_ENABLED=1` and
 * `ANTHROPIC_API_KEY` is set. Otherwise the original mock stream still serves,
 * so an environment that has not been given a key behaves exactly as it did
 * before this file changed — the same rule every other flag in this codebase
 * follows. Both paths emit the same incremental plain text, so nothing outside
 * this file knows which one answered.
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
  if (!credential.ok) return mockResponse(parsed.messages);

  return providerResponse(parsed.messages, credential.apiKey, request.signal);
}

/**
 * The real model call.
 *
 * The first delta is awaited before a `Response` is returned. Once a 200 and
 * its headers are on the wire the status can no longer be corrected, so a
 * failure that happens up front — a rejected key, a rate limit, an overloaded
 * model — would otherwise reach the browser as an empty but apparently
 * successful stream. Waiting costs the first token's latency and buys an
 * accurate status code for every error that occurs before generation starts.
 */
async function providerResponse(
  messages: ChatTurn[],
  apiKey: string,
  signal: AbortSignal
): Promise<Response> {
  const client = new Anthropic({ apiKey });

  const stream = client.beta.messages.stream(
    {
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: AI_SYSTEM_PROMPT,
      messages,
      output_config: { effort: AI_EFFORT },
      // Thinking is on by default on this model and its text is not returned.
      // Only `text_delta` is forwarded below, so reasoning can never be
      // streamed into the thread as though it were the answer.
      //
      // On a policy decline the API re-runs the request on a fallback model
      // inside the same call, routed by refusal category. Without it a declined
      // request simply stops, which in a chat surface is an unexplained blank
      // reply.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    // Forwards a client disconnect to the provider. Without it, closing the
    // thread leaves a generation running that nobody will read and everybody
    // pays for.
    { signal }
  );

  const encoder = new TextEncoder();
  const iterator = stream[Symbol.asyncIterator]();

  // Drained up to the first text so an early failure is still a real status
  // code rather than a silent empty stream.
  const opened = await openTextStream(iterator);
  if (!opened.ok) {
    // Nothing has been sent yet, so the status is still ours to choose.
    stream.abort();
    return providerError(opened.error);
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let produced = false;
      const write = (text: string) => {
        controller.enqueue(encoder.encode(text));
        produced = true;
      };
      try {
        for (const chunk of opened.first) write(chunk);
        if (!opened.exhausted) {
          for await (const chunk of remainingText(iterator)) write(chunk);
        }
        if (!produced) write(EMPTY_TURN_TEXT);
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The reader went away; stop generating.
      stream.abort();
    },
  });

  return new Response(readable, { headers: STREAM_HEADERS });
}

/**
 * Map a provider failure onto a status, without forwarding its message.
 *
 * The SDK's typed classes are matched most specific first. A bad key is ours
 * to fix and is reported as a server fault, never as the caller's.
 */
function providerError(error: unknown): NextResponse {
  if (error instanceof Anthropic.APIUserAbortError) {
    // The caller hung up before the first token. Nothing to report.
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

/**
 * The original mock stream, unchanged in behaviour.
 *
 * Kept so an environment without a key behaves exactly as it did before, and
 * so the thread UI stays exercisable in development without spending anything.
 */
function mockResponse(messages: ChatTurn[]): Response {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const reply = mockReplyFor(lastUser?.content ?? "");

  const encoder = new TextEncoder();
  const chunks = reply.match(/\S+\s*/g) ?? [reply];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // First-token latency, then a steady token cadence with jitter.
        await sleep(350 + Math.random() * 400);
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          await sleep(12 + Math.random() * 28);
        }
        controller.close();
      } catch {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
