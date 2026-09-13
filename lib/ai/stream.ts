/**
 * Turning a provider event stream into the plain text the thread renders.
 *
 * Separated from the route so it can be tested against synthetic event
 * sequences. The cases that matter here — a failure before any text, a turn
 * that produces no text at all, reasoning events that must never be forwarded
 * — are all ones a live call would show only intermittently, if at all.
 *
 * No credential is read in this module; it holds no secrets and makes no
 * network call of its own.
 */
import type Anthropic from "@anthropic-ai/sdk";

/** A provider event, narrowed to what this module needs from it. */
export type ProviderEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

/**
 * The text carried by one event, or null for every other kind.
 *
 * Only `text_delta` is text. `thinking_delta` is reasoning: on this model it
 * is not returned as readable text anyway, but forwarding it on any model
 * would put the model's working out into the thread as though it were the
 * answer. Filtering by delta type rather than trusting the model's
 * configuration keeps that impossible instead of merely unlikely.
 */
export function textDelta(event: ProviderEvent): string | null {
  if (event.type !== "content_block_delta") return null;
  if (event.delta.type !== "text_delta") return null;
  return event.delta.text;
}

export type OpenedStream =
  | { ok: false; error: unknown }
  | { ok: true; first: string[]; exhausted: boolean };

/**
 * Consume events until the first text arrives.
 *
 * The point is the status code. Once a 200 and its headers are on the wire
 * they cannot be corrected, so a rejected key or a rate limit would otherwise
 * reach the browser as an empty but apparently successful stream. Draining up
 * to the first text costs that token's latency and buys an accurate status for
 * every failure that happens before generation starts.
 *
 * `exhausted` distinguishes "the stream ended without producing text" — a
 * refusal, or an immediate stop — from "text is available and more may
 * follow". The caller needs that to decide whether to keep pumping.
 */
export async function openTextStream(
  iterator: AsyncIterator<ProviderEvent>
): Promise<OpenedStream> {
  const first: string[] = [];
  try {
    while (first.length === 0) {
      const next = await iterator.next();
      if (next.done) return { ok: true, first, exhausted: true };
      const text = textDelta(next.value);
      if (text) first.push(text);
    }
  } catch (error) {
    return { ok: false, error };
  }
  return { ok: true, first, exhausted: false };
}

/**
 * Yield the text of every remaining event.
 *
 * Errors are deliberately swallowed. By the time this runs the status is long
 * gone and partial text is already rendered, so the turn ends where it broke
 * rather than appending an error into the middle of the assistant's own
 * sentence. The provider's message is never forwarded in any case — it can
 * carry request and account identifiers.
 */
export async function* remainingText(
  iterator: AsyncIterator<ProviderEvent>
): AsyncGenerator<string> {
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      const text = textDelta(next.value);
      if (text) yield text;
    }
  } catch {
    return;
  }
}

/**
 * What to show when a turn produced no text at all.
 *
 * A refusal the fallback chain did not rescue ends with empty content. An
 * empty bubble reads as a broken dashboard, so the turn says what happened.
 */
export const EMPTY_TURN_TEXT =
  "I can't help with that request. Try rephrasing it, or ask me something else.";
