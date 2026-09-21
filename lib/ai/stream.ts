/**
 * Accumulating one round of a turn.
 *
 * This used to parse one vendor's wire protocol. It no longer knows there is
 * such a thing: an adapter hands it text and tool calls, and it decides what
 * the user sees and what the executor is asked for. That is the whole of the
 * split — protocol below, policy above — and it is why a second provider is a
 * translation rather than a second orchestration.
 *
 * No SDK import, no server-only import: a test can drive this with a literal
 * array of events and neither vendor's package installed.
 */
import type { NeutralToolCall, TurnEvent } from "./providers/types.ts";

export type { NeutralToolCall as PendingToolUse };

/**
 * Everything one assistant round produced.
 *
 * The text has already gone to the browser by the time this is read; it is
 * kept so the round can be replayed as history to the next one, which both
 * vendors require for tool results to attach to anything.
 */
export interface RoundResult {
  text: string;
  toolCalls: NeutralToolCall[];
  /** True when the stream threw partway. Text already sent stays sent. */
  broke: boolean;
}

export function emptyRound(): RoundResult {
  return { text: "", toolCalls: [], broke: false };
}

/**
 * Drain one round, yielding the text the user sees.
 *
 * Tool calls are recorded, never yielded: the user asked a question and is
 * owed an answer, not a transcript of the lookups behind it. Whether the round
 * wants tools is decided by whether any arrived — no vendor's word for why it
 * stopped is consulted, so the two can never disagree about it.
 *
 * A mid-stream failure sets `broke` and ends quietly. By then a 200 and some
 * text are already on the wire, so there is no status left to correct and
 * appending a provider error into the middle of a sentence would only make the
 * turn less readable. The caller decides what to say about it.
 */
export async function* streamRound(
  events: AsyncIterator<TurnEvent>,
  round: RoundResult
): AsyncGenerator<string> {
  try {
    while (true) {
      const next = await events.next();
      if (next.done) return;
      const event = next.value;
      if (event.type === "text") {
        round.text += event.text;
        yield event.text;
        continue;
      }
      round.toolCalls.push(event.call);
    }
  } catch {
    round.broke = true;
  }
}

/**
 * What to show when a turn produced no text at all.
 *
 * A refusal that no fallback rescued ends with empty content. An empty bubble
 * reads as a broken dashboard, so the turn says what happened.
 */
export const EMPTY_TURN_TEXT =
  "I can't help with that request. Try rephrasing it, or ask me something else.";

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
