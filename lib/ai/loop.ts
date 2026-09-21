import "server-only";

/**
 * The tool loop — FortMark's, not a vendor's.
 *
 * The model asks for tools; the server runs them and hands back results; the
 * model answers. Everything careful about it is bounds and honesty, and none
 * of it is delegated to whoever is doing the reasoning.
 *
 * **It is bounded here.** At most `MAX_TOOL_ROUNDS` round trips, at most
 * `MAX_TOOL_CALLS_PER_ROUND` calls in each, each with its own timeout. The
 * final round is opened with tool use switched off — by whichever mechanism
 * that vendor has — so the turn always ends in an answer rather than in
 * another request the budget cannot pay for. No provider's own limits are
 * relied on; a vendor that ignored them would still be stopped by this file.
 *
 * **It never speaks for the model.** Only text reaches the browser. Tool
 * names, tool arguments and tool results are not narrated into the thread.
 *
 * **It never hides a failure.** A provider that stops mid-turn appends a line
 * saying so. A tool that could not run returns a structured error the model is
 * instructed to report. Nothing here can turn "we could not look" into "there
 * is nothing".
 *
 * The provider is injected, so the loop can be exercised against a scripted
 * event sequence with no vendor, no key and no network — which is the only way
 * the interesting cases (a broken stream, unparseable arguments, a model that
 * keeps calling tools forever) can be tested at all, and the only way the two
 * adapters can be shown to behave identically.
 */
import { MAX_TOOL_ROUNDS } from "./provider.ts";
import {
  EMPTY_TURN_TEXT,
  emptyRound,
  INTERRUPTED_TEXT,
  streamRound,
  TOOL_BUDGET_TEXT,
  type RoundResult,
} from "./stream.ts";
import { executeRound, toolResultPayload, type ExecuteOptions, type ToolRequest } from "./tools/execute.ts";
import type { ToolContext } from "./tools/types.ts";
import type { AiProvider, NeutralTurn, OpenedRound } from "./providers/types.ts";

/**
 * Run a whole assistant turn, yielding the text the user sees.
 *
 * `first` is already open: the route opens the first round itself so that a
 * rejected key or a rate limit is an accurate HTTP status rather than an empty
 * but apparently successful stream.
 */
export async function* runAssistant(
  history: NeutralTurn[],
  first: OpenedRound,
  ctx: ToolContext,
  provider: Pick<AiProvider, "openRound">,
  /** Defaulted to the real registry; a parameter only so tests can script it. */
  execution: ExecuteOptions = {}
): AsyncGenerator<string> {
  const turns: NeutralTurn[] = [...history];
  let opened = first;
  let produced = false;

  for (let round = 0; ; round++) {
    const result = emptyRound();
    for await (const chunk of streamRound(opened.events, result)) {
      produced = true;
      yield chunk;
    }

    if (result.broke) {
      yield INTERRUPTED_TEXT;
      return;
    }

    if (result.toolCalls.length === 0) {
      // A turn that produced nothing at all is a refusal no fallback rescued.
      // An empty bubble reads as a broken dashboard.
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

    const requests: ToolRequest[] = result.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      input: call.input,
      invalid: call.invalid,
    }));
    const executions = await executeRound(requests, ctx, execution);
    console.info(`[ai] turn=${ctx.traceId} round=${round + 1} tools=${executions.length}`);

    turns.push(assistantTurn(result), toolResultTurn(executions));

    // One more round than the budget allows would be a round that can only ask
    // again. The last one is opened unable to.
    const isFinal = round + 1 >= MAX_TOOL_ROUNDS;
    try {
      opened = await provider.openRound(turns, { allowTools: !isFinal });
    } catch {
      yield INTERRUPTED_TEXT;
      return;
    }
  }
}

/**
 * The round the model just produced, replayed as history.
 *
 * Both vendors need the calls back to attach the results to. The text is
 * replayed alongside them exactly as it was streamed, so the next round sees
 * what the user already saw.
 */
function assistantTurn(result: RoundResult): NeutralTurn {
  return { role: "assistant", text: result.text, toolCalls: result.toolCalls };
}

/**
 * Every result of one round, together.
 *
 * A failed call is returned as an error rather than dropped: a tool call with
 * no result is a malformed conversation on either vendor.
 */
function toolResultTurn(executions: Awaited<ReturnType<typeof executeRound>>): NeutralTurn {
  return {
    role: "tool_results",
    results: executions.map((execution) => ({
      id: execution.id,
      name: execution.name,
      payload: toolResultPayload(execution),
      isError: !execution.outcome.ok,
    })),
  };
}
