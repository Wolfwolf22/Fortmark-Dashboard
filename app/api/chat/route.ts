import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { mockReplyFor } from "@/lib/ai/mock-response";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";

export const runtime = "nodejs";

/** Per-user output; never cached or statically generated. */
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  mode?: string;
}

/**
 * Streaming chat endpoint.
 *
 * Authorization is enforced here as well as in `middleware.ts`: a route
 * handler is the last line of defence for the data it returns, and must not
 * depend on a matcher pattern staying correct.
 *
 * TODO: connect provider — replace the mock block below with a real model
 * call (e.g. Anthropic Messages API with stream: true), forwarding
 * `messages` and mapping provider deltas onto the same plain-text stream.
 * The client (`lib/ai/client.ts`) already consumes an incremental text
 * stream, so nothing outside this file changes.
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
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const body = (await request.json()) as ChatRequestBody;
  const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const reply = mockReplyFor(lastUser?.content ?? "");

  // --- mock stream: word-chunked with realistic latency -------------------
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
  // ------------------------------------------------------------------------

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // FortMark content tied to one user — never shared or stored by a cache.
      "Cache-Control": "private, no-store",
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
