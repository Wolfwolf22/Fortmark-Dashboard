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

/**
 * What to show when a turn produced no text at all.
 *
 * A refusal the fallback chain did not rescue ends with empty content. An
 * empty bubble reads as a broken dashboard, so the turn says what happened.
 */
export const EMPTY_TURN_TEXT =
  "I can't help with that request. Try rephrasing it, or ask me something else.";

// --- Rounds ------------------------------------------------------------------

/**
 * One tool call the model asked for, assembled from its streamed events.
 *
 * `invalid` marks arguments that did not survive `JSON.parse`. That is
 * recorded rather than thrown: the call still has an id, the model is still
 * owed a `tool_result` for it, and the honest result is an error saying the
 * arguments were unreadable.
 */
export interface PendingToolUse {
  id: string;
  name: string;
  input: unknown;
  invalid?: boolean;
}

/**
 * Everything one assistant turn produced, accumulated as it streamed.
 *
 * The text has already gone to the browser by the time this is read; it is
 * kept so the turn can be replayed as history on the next round, which the
 * API requires for the tool results to attach to anything.
 */
export interface RoundResult {
  text: string;
  toolUses: PendingToolUse[];
  stopReason: string | null;
  /** True when the stream threw partway. Text already sent stays sent. */
  broke: boolean;
}

export function emptyRound(): RoundResult {
  return { text: "", toolUses: [], stopReason: null, broke: false };
}

type Partial = { id: string; name: string; json: string };

/**
 * Drain one round, yielding its visible text and recording everything else.
 *
 * Reasoning never leaves this function. Tool arguments never leave it as text
 * either — a `tool_use` block's JSON is accumulated into `round`, never
 * yielded, because the user asked a question and is owed an answer, not a
 * transcript of the lookups behind it.
 *
 * A mid-stream failure sets `broke` and ends quietly. By then a 200 and some
 * text are already on the wire, so there is no status left to correct and
 * appending a provider error into the middle of a sentence would only make
 * the turn less readable. The caller decides what to say about it.
 */
export async function* streamRound(
  iterator: AsyncIterator<ProviderEvent>,
  round: RoundResult
): AsyncGenerator<string> {
  const partials = new Map<number, Partial>();
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      const event = next.value;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          partials.set(event.index, { id: block.id, name: block.name, json: "" });
        }
        continue;
      }

      if (event.type === "content_block_delta") {
        const chunk = textDelta(event);
        if (chunk !== null) {
          round.text += chunk;
          yield chunk;
          continue;
        }
        if (event.delta.type === "input_json_delta") {
          const partial = partials.get(event.index);
          if (partial) partial.json += event.delta.partial_json;
        }
        // Every other delta — thinking above all — is not the answer.
        continue;
      }

      if (event.type === "content_block_stop") {
        const partial = partials.get(event.index);
        if (!partial) continue;
        partials.delete(event.index);
        round.toolUses.push(finishToolUse(partial));
        continue;
      }

      if (event.type === "message_delta") {
        round.stopReason = event.delta.stop_reason ?? round.stopReason;
      }
    }
  } catch {
    round.broke = true;
  }
}

/**
 * Turn accumulated argument JSON into an input object.
 *
 * Empty is `{}` — a no-argument tool streams nothing at all — and anything
 * unparseable is flagged rather than guessed at. Tool inputs here are buffered
 * by the provider, so a truncated body means something went wrong upstream,
 * not that more is coming.
 */
function finishToolUse(partial: Partial): PendingToolUse {
  const raw = partial.json.trim();
  if (raw.length === 0) return { id: partial.id, name: partial.name, input: {} };
  try {
    return { id: partial.id, name: partial.name, input: JSON.parse(raw) };
  } catch {
    return { id: partial.id, name: partial.name, input: {}, invalid: true };
  }
}

/**
 * Appended when a turn ends because the provider stopped answering partway.
 *
 * Silence would read as a complete reply that happened to stop making sense.
 */
export const INTERRUPTED_TEXT =
  "\n\n_The reply was cut short before it finished. Ask again to continue._";

/**
 * Appended when the tool budget runs out with the model still calling tools.
 *
 * The user is told the answer is based on what was gathered so far, rather
 * than being left to assume it looked at everything.
 */
export const TOOL_BUDGET_TEXT =
  "\n\n_I stopped looking things up before finishing. Narrow the question and I can go further._";
