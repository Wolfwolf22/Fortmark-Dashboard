import "server-only";

/**
 * The OpenAI adapter, over the Responses API.
 *
 * It is the mirror of the Anthropic one and it has the same job and the same
 * limits: translate, and nothing else. It defines no tool of its own, reads no
 * record, validates no argument, counts no round and enforces no timeout —
 * those are FortMark's, they happen above this file, and a question answered
 * here executes exactly the same domain services it would have on the other
 * vendor.
 *
 * Three decisions specific to this API are worth stating:
 *
 * `store: false`. The Responses API retains responses by default so they can
 * be fetched later. A FortMark turn contains a brokerage's client records, and
 * FortMark does not get to decide on its clients' behalf that a vendor should
 * keep a copy. Nothing about this integration depends on retrieval, so it is
 * switched off on every request.
 *
 * Reasoning is never forwarded. gpt-5 models reason, and the API can stream
 * summaries of it; no summary is requested and no reasoning event is
 * translated, so it cannot reach the thread as though it were the answer.
 *
 * Tool calls are read from `response.output_item.done`, which carries the
 * finished call with its arguments complete, rather than reassembled from
 * `function_call_arguments.delta`. There is nothing to half-parse, and no
 * fragment can escape as text.
 */
import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { AI_MAX_TOKENS, systemPrompt, AI_EFFORT } from "../provider.ts";
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

export type WireEvent = Responses.ResponseStreamEvent;

export function openaiProvider(
  apiKey: string,
  model: string,
  signal: AbortSignal,
  registry: FortmarkTool<never, unknown>[]
): AiProvider {
  const client = new OpenAI({ apiKey });
  // Which tools exist is FortMark's decision, made before the adapter is
  // constructed. An adapter never consults a flag or the environment.
  const tools = toolDefinitions(registry);
  // The prompt describes exactly the tools that were handed over, so it can
  // never claim a capability this deployment withheld.
  const prompt = systemPrompt(registry);

  return {
    name: "openai",
    model,
    classify,
    async openRound(turns: NeutralTurn[], options: RoundOptions): Promise<OpenedRound> {
      // Two ways this round can be cancelled, and both must reach the vendor:
      // the caller disconnecting, and the loop giving up on a later round.
      // Composed rather than wired by hand, so a turn that runs the full
      // budget does not accumulate a listener per round on the request.
      //
      // Without either, closing the thread leaves a generation running that
      // nobody will read and everybody pays for.
      const controller = new AbortController();
      const cancel = AbortSignal.any([signal, controller.signal]);

      const stream = await client.responses.create(
        {
          model,
          instructions: prompt,
          input: turns.flatMap(toInputItems),
          tools,
          // The final round is opened unable to ask for anything more, so the
          // turn ends in an answer rather than in another request.
          tool_choice: options.allowTools ? "auto" : "none",
          max_output_tokens: AI_MAX_TOKENS,
          // Depth of reasoning, mirroring the other adapter's effort. No
          // summary is requested, so none is produced to leak.
          reasoning: { effort: AI_EFFORT },
          // See the header. A brokerage's records are not the vendor's to keep.
          store: false,
          stream: true,
        },
        { signal: cancel }
      );

      const wire = stream[Symbol.asyncIterator]() as AsyncIterator<WireEvent>;
      // Awaited before the round is declared open, so a rejected key or a rate
      // limit is still a status rather than an empty but successful stream.
      const head = await wire.next();

      return {
        events: toTurnEvents(replay(head, wire)),
        abort: () => controller.abort(),
      };
    },
  };
}

/** The tools, rendered into OpenAI's shape from the one registry. */
export function toolDefinitions(
  registry: FortmarkTool<never, unknown>[]
): Responses.FunctionTool[] {
  return registry.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as Record<string, unknown>,
    // The registry's schemas carry length and range bounds that guide a model
    // well; strict mode restricts which keywords a tool may declare, and a
    // keyword the provider refuses is an error on every turn. The enforcement
    // that matters is server-side: every argument is re-parsed against this
    // same schema before a service is reached.
    strict: false,
  }));
}

/**
 * FortMark's history, rendered into Responses input items.
 *
 * One neutral turn can become several items — an assistant turn that both
 * spoke and called two tools is three — which is why this returns a list.
 */
export function toInputItems(turn: NeutralTurn): Responses.ResponseInputItem[] {
  if (turn.role === "user") return [{ role: "user", content: turn.text }];

  if (turn.role === "tool_results") {
    return turn.results.map((result) => ({
      type: "function_call_output" as const,
      call_id: result.id,
      output: result.payload,
    }));
  }

  const items: Responses.ResponseInputItem[] = [];
  if (turn.text.length > 0) items.push({ role: "assistant", content: turn.text });
  for (const call of turn.toolCalls) {
    items.push({
      type: "function_call" as const,
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input ?? {}),
    });
  }
  return items;
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
 * OpenAI's wire events, as text and tool calls.
 *
 * Everything not named here is dropped, which is the point: reasoning text,
 * reasoning summaries, refusal deltas, annotation events, argument fragments
 * and every server-tool event this integration does not use cannot reach the
 * thread, because there is no branch that would let them.
 *
 * A failed or errored response throws, so the loop reports the turn as cut
 * short rather than ending on a half-sentence that reads as complete.
 */
export async function* toTurnEvents(wire: AsyncIterable<WireEvent>): AsyncGenerator<TurnEvent> {
  for await (const event of wire) {
    if (event.type === "response.output_text.delta") {
      yield { type: "text", text: event.delta };
      continue;
    }

    if (event.type === "response.output_item.done") {
      const item = event.item;
      if (item.type === "function_call") {
        yield { type: "tool_call", call: finish(item.call_id, item.name, item.arguments) };
      }
      continue;
    }

    if (event.type === "response.failed" || event.type === "error") {
      // Deliberately message-free: an upstream error string can carry request
      // and account identifiers, and the user is owed the fact, not the detail.
      throw new Error("the provider ended the response");
    }
  }
}

/**
 * Argument JSON, as an input object.
 *
 * Empty is `{}` — a no-argument tool sends nothing — and anything unparseable
 * is flagged rather than guessed at. The call still has an id and is still
 * owed a result; the honest one says the arguments were unreadable.
 */
export function finish(id: string, name: string, raw: string): NeutralToolCall {
  const text = (raw ?? "").trim();
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
  if (error instanceof OpenAI.APIUserAbortError) return "cancelled";
  if (error instanceof OpenAI.RateLimitError) return "rate_limited";
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return "auth";
  }
  if (error instanceof OpenAI.BadRequestError) return "bad_request";
  return "unavailable";
}
