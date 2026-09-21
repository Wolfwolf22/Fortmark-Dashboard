import "server-only";

/**
 * The Anthropic adapter.
 *
 * Every property the single-provider implementation had is preserved here,
 * and the ones that are easy to lose in a refactor are the ones worth naming:
 * only `text_delta` reaches the user, reasoning never does, tool arguments are
 * accumulated rather than streamed into the thread, unparseable arguments are
 * flagged rather than guessed at, the client's disconnect is forwarded to the
 * provider, and the first wire event is awaited before the round is declared
 * open so an early failure is still a real HTTP status.
 *
 * What is NOT here is as important: no tool is defined, no argument is
 * validated, no record is read, no round is counted and no timeout is
 * enforced. Those are FortMark's, they happen above this file, and they happen
 * identically whichever vendor answered.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AI_EFFORT, AI_MAX_TOKENS, systemPrompt } from "../provider.ts";
import type { FortmarkTool } from "../tools/types.ts";
import type {
  AiProvider,
  NeutralToolCall,
  NeutralTurn,
  OpenedRound,
  ProviderFailureKind,
  RoundOptions,
  TurnEvent,
} from "./types.ts";

export type WireEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

export function anthropicProvider(
  apiKey: string,
  model: string,
  signal: AbortSignal,
  registry: FortmarkTool<never, unknown>[]
): AiProvider {
  const client = new Anthropic({ apiKey });
  // Which tools exist is FortMark's decision, made before the adapter is
  // constructed. An adapter never consults a flag or the environment.
  const tools = toolDefinitions(registry);
  // The prompt describes exactly the tools that were handed over, so it can
  // never claim a capability this deployment withheld.
  const prompt = systemPrompt(registry);

  return {
    name: "anthropic",
    model,
    classify,
    async openRound(turns: NeutralTurn[], options: RoundOptions): Promise<OpenedRound> {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: AI_MAX_TOKENS,
          system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
          messages: turns.map(toMessage),
          tools,
          // The final round is opened unable to ask for anything more, so the
          // turn ends in an answer rather than in another request.
          tool_choice: options.allowTools ? { type: "auto" } : { type: "none" },
          output_config: { effort: AI_EFFORT },
          // Thinking is on by default on this model and its text is not
          // returned. Only text deltas are translated below, so reasoning can
          // never be streamed into the thread as though it were the answer.
          //
          // On a policy decline the API re-runs the request on a fallback
          // model inside the same call, routed by refusal category. Without it
          // a declined request simply stops, which in a chat surface is an
          // unexplained blank reply.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        // Forwards a client disconnect to the provider. Without it, closing
        // the thread leaves a generation running that nobody will read and
        // everybody pays for.
        { signal }
      );

      const wire = stream[Symbol.asyncIterator]() as AsyncIterator<WireEvent>;
      // Awaited before the round is declared open, so a rejected key or a rate
      // limit is still a status rather than an empty but successful stream.
      const head = await wire.next();

      return {
        events: toTurnEvents(replay(head, wire)),
        abort: () => stream.abort(),
      };
    },
  };
}

/** The tools, rendered into Anthropic's shape from the one registry. */
export function toolDefinitions(
  registry: FortmarkTool<never, unknown>[]
): Anthropic.Beta.BetaTool[] {
  return registry.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
  }));
}

/** FortMark's history, rendered into Anthropic messages. */
export function toMessage(turn: NeutralTurn): Anthropic.Beta.BetaMessageParam {
  if (turn.role === "user") return { role: "user", content: turn.text };

  if (turn.role === "tool_results") {
    // All of them in a single message: splitting results across messages
    // teaches the model to stop asking for tools in parallel.
    return {
      role: "user",
      content: turn.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: result.payload,
        is_error: result.isError,
      })),
    };
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (turn.text.length > 0) content.push({ type: "text", text: turn.text });
  for (const call of turn.toolCalls) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: (call.input ?? {}) as Record<string, unknown>,
    });
  }
  return { role: "assistant", content };
}

/** Put a pulled-ahead event back at the front of the stream. */
async function* replay(
  head: IteratorResult<WireEvent>,
  rest: AsyncIterator<WireEvent>
): AsyncGenerator<WireEvent> {
  if (head.done) return;
  yield head.value;
  while (true) {
    const next = await rest.next();
    if (next.done) return;
    yield next.value;
  }
}

/**
 * Anthropic's wire events, as text and tool calls.
 *
 * A `tool_use` block's arguments arrive as a run of JSON fragments across
 * several events; they are accumulated here and emitted once complete, so
 * nothing half-parsed is ever handed to the executor and no fragment is ever
 * yielded as text. Every other event kind — `thinking_delta` above all — is
 * dropped, because the user asked a question and is owed an answer rather than
 * a transcript of the reasoning behind it.
 */
export async function* toTurnEvents(wire: AsyncIterable<WireEvent>): AsyncGenerator<TurnEvent> {
  const partials = new Map<number, { id: string; name: string; json: string }>();

  for await (const event of wire) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        partials.set(event.index, { id: block.id, name: block.name, json: "" });
      }
      continue;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
        continue;
      }
      if (event.delta.type === "input_json_delta") {
        const partial = partials.get(event.index);
        if (partial) partial.json += event.delta.partial_json;
      }
      continue;
    }

    if (event.type === "content_block_stop") {
      const partial = partials.get(event.index);
      if (!partial) continue;
      partials.delete(event.index);
      yield { type: "tool_call", call: finish(partial.id, partial.name, partial.json) };
    }
  }
}

/**
 * Accumulated argument JSON, as an input object.
 *
 * Empty is `{}` — a no-argument tool streams nothing at all — and anything
 * unparseable is flagged rather than guessed at. The call still has an id and
 * is still owed a result; the honest one says the arguments were unreadable.
 */
export function finish(id: string, name: string, raw: string): NeutralToolCall {
  const text = raw.trim();
  if (text.length === 0) return { id, name, input: {} };
  try {
    return { id, name, input: JSON.parse(text) };
  } catch {
    return { id, name, input: {}, invalid: true };
  }
}

/**
 * A thrown SDK error, as a neutral kind.
 *
 * Matched most specific first. The provider's own message is never forwarded:
 * it can carry request and account identifiers.
 */
export function classify(error: unknown): ProviderFailureKind {
  if (error instanceof Anthropic.APIUserAbortError) return "cancelled";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return "auth";
  }
  if (error instanceof Anthropic.BadRequestError) return "bad_request";
  return "unavailable";
}
