/**
 * The AI client seam. `sendMessage` streams tokens from `/api/chat`; the UI
 * consumes the AsyncIterable and never knows what happened on the other side.
 *
 * There is no local fallback. When the route says the assistant is not
 * connected, that is what the screen says — it never substitutes a generated
 * reply, because a fabricated answer in a thread is indistinguishable from a
 * real one and this surface talks about prices.
 */
import { apiPath } from "@/lib/routes";
import { ChatMessage, SendMessageOptions } from "./types";

/**
 * A failed turn, with the route's own reason attached.
 *
 * The distinction the UI needs is between "this deployment has no assistant"
 * and "something went wrong this time": the first is a standing fact worth
 * stating plainly, the second is worth retrying.
 */
export class ChatError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(MESSAGES[code] ?? MESSAGES[String(status)] ?? "The reply could not be loaded.");
    this.name = "ChatError";
    this.status = status;
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  not_configured: "The assistant is not connected in this environment.",
  "429": "The assistant is busy right now. Try again in a moment.",
  "413": "That message is too long to send.",
  "403": "Your account is not approved for the assistant.",
  "401": "Your session has expired. Sign in again.",
};

/** The route's reason code, when it gave one. Never its internal detail. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : String(response.status);
  } catch {
    return String(response.status);
  }
}

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
    throw new ChatError(response.status, await errorCode(response));
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
