/**
 * The AI client seam. `sendMessage` streams tokens from `/api/chat`; the UI
 * consumes the AsyncIterable and never knows which provider is behind it.
 * Swapping in the real model happens in `app/api/chat/route.ts` — one file.
 */
import { apiPath } from "@/lib/routes";
import { ChatMessage, SendMessageOptions } from "./types";

export async function* sendMessage(
  messages: Pick<ChatMessage, "role" | "content">[],
  opts: SendMessageOptions = {}
): AsyncIterable<string> {
  // basePath-aware: a bare "/api/chat" resolves to the portal zone and 404s.
  const response = await fetch(apiPath("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      mode: opts.mode,
    }),
    signal: opts.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
