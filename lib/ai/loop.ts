import "server-only";

/**
 * The tool loop.
 *
 * The model asks for tools; the server runs them and hands back results; the
 * model answers. That is the whole shape, and everything careful about it is
 * about bounds and honesty.
 *
 * **It is bounded.** At most `MAX_TOOL_ROUNDS` round trips, at most
 * `MAX_TOOL_CALLS_PER_ROUND` calls in each, each with its own timeout. The
 * final round is opened with tool use switched off, so the turn always ends in
 * an answer rather than in another request the budget cannot pay for.
 *
 * **It never speaks for the model.** Only `text_delta` reaches the browser.
 * Tool names, tool arguments and tool results are not narrated into the
 * thread: the user asked a question, not for a transcript of the lookups.
 *
 * **It never hides a failure.** A provider that stops mid-turn appends a line
 * saying so. A tool that could not run returns a structured error the model is
 * instructed to report rather than paper over. Nothing in this file can turn
 * "we could not look" into "there is nothing".
 *
 * The opener is injected so the loop can be exercised against a scripted
 * event sequence with no provider, no key and no network — which is the only
 * way the interesting cases (a broken stream, unparseable arguments, a model
 * that keeps calling tools forever) can be tested at all.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_TOOL_ROUNDS } from "./provider.ts";
import {
  EMPTY_TURN_TEXT,
  emptyRound,
  INTERRUPTED_TEXT,
  streamRound,
  TOOL_BUDGET_TEXT,
  type ProviderEvent,
  type RoundResult,
} from "./stream.ts";
import {
  executeRound,
  toolResultPayload,
  type ExecuteOptions,
  type ToolRequest,
} from "./tools/execute.ts";
import type { ToolContext } from "./tools/types.ts";

export type Turn = Anthropic.Beta.BetaMessageParam;

/** A round that has been started and has produced at least one event. */
export interface OpenedRound {
  iterator: AsyncIterator<ProviderEvent>;
  /** Stop generating. Called when the reader goes away or the loop gives up. */
  abort: () => void;
}

/**
 * Start one round.
 *
 * `allowTools` false is the final round: the model is told it may not call
 * anything further, so it has no choice but to answer with what it has.
 */
export type RoundOpener = (
  messages: Turn[],
  options: { allowTools: boolean }
) => Promise<OpenedRound>;

/**
 * Run a whole assistant turn, yielding the text the user sees.
 *
 * `first` is already open: the route opens the first round itself so that a
 * rejected key or a rate limit is still an accurate HTTP status rather than an
 * empty but apparently successful stream.
 */
export async function* runAssistant(
  history: Turn[],
  first: OpenedRound,
  ctx: ToolContext,
  open: RoundOpener,
  /** Defaulted to the real registry; a parameter only so tests can script it. */
  execution: ExecuteOptions = {}
): AsyncGenerator<string> {
  const messages: Turn[] = [...history];
  let opened = first;
  let produced = false;

  for (let round = 0; ; round++) {
    const result = emptyRound();
    for await (const chunk of streamRound(opened.iterator, result)) {
      produced = true;
      yield chunk;
    }

    if (result.broke) {
      yield INTERRUPTED_TEXT;
      return;
    }

    const wantsTools = result.stopReason === "tool_use" && result.toolUses.length > 0;
    if (!wantsTools) {
      // A turn that produced nothing at all is a refusal the fallback chain
      // did not rescue. An empty bubble reads as a broken dashboard.
      if (!produced) yield EMPTY_TURN_TEXT;
      return;
    }

    if (round >= MAX_TOOL_ROUNDS) {
      // Belt and braces: the final round is opened with tools switched off, so
      // reaching here means the model asked anyway. It is not obliged.
      yield TOOL_BUDGET_TEXT;
      opened.abort();
      return;
    }

    const requests: ToolRequest[] = result.toolUses.map((use) => ({
      id: use.id,
      name: use.name,
      input: use.input,
      invalid: use.invalid,
    }));
    const executions = await executeRound(requests, ctx, execution);
    console.info(`[ai] round=${round + 1} tools=${executions.length}`);

    messages.push(assistantTurn(result), toolResultTurn(executions));

    // One more round than the budget allows would be a round that can only ask
    // again. The last one is opened unable to.
    const isFinal = round + 1 >= MAX_TOOL_ROUNDS;
    try {
      opened = await open(messages, { allowTools: !isFinal });
    } catch {
      yield INTERRUPTED_TEXT;
      return;
    }
  }
}

/**
 * The turn the model just produced, replayed as history.
 *
 * The API needs the `tool_use` blocks back to attach the results to. The text
 * is replayed alongside them exactly as it was streamed, so the model's next
 * round sees what the user already saw.
 */
function assistantTurn(result: RoundResult): Turn {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (result.text.length > 0) content.push({ type: "text", text: result.text });
  for (const use of result.toolUses) {
    content.push({
      type: "tool_use",
      id: use.id,
      name: use.name,
      input: (use.input ?? {}) as Record<string, unknown>,
    });
  }
  return { role: "assistant", content };
}

/**
 * Every result in one user turn.
 *
 * All of them, together, in a single message: splitting results across
 * messages teaches the model to stop asking for tools in parallel, and a
 * failed call is returned as an error rather than dropped, because a tool_use
 * with no tool_result is a malformed conversation.
 */
function toolResultTurn(executions: Awaited<ReturnType<typeof executeRound>>): Turn {
  return {
    role: "user",
    content: executions.map((execution) => ({
      type: "tool_result" as const,
      tool_use_id: execution.id,
      content: toolResultPayload(execution),
      is_error: !execution.outcome.ok,
    })),
  };
}
