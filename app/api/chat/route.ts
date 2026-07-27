import { NextRequest } from "next/server";
import { mockReplyFor } from "@/lib/ai/mock-response";

export const runtime = "nodejs";

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  mode?: string;
}

/**
 * Streaming chat endpoint.
 *
 * TODO: connect provider — replace the mock block below with a real model
 * call (e.g. Anthropic Messages API with stream: true), forwarding
 * `messages` and mapping provider deltas onto the same plain-text stream.
 * The client (`lib/ai/client.ts`) already consumes an incremental text
 * stream, so nothing outside this file changes.
 */
export async function POST(request: NextRequest) {
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
      "Cache-Control": "no-store",
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
