/**
 * The line between FortMark and whoever is doing the reasoning.
 *
 * Everything above this file is FortMark's: the tool registry, the
 * authorization, the DTOs, the round budget, the timeouts, the audit logging.
 * Everything below it is one vendor's wire protocol. An adapter's entire job
 * is to translate, and it is not permitted to do anything else — no adapter
 * reads a record, resolves an actor, validates a tool argument or decides how
 * many rounds a turn may take.
 *
 * The vocabulary is deliberately small, because a small vocabulary is what
 * keeps a second provider from becoming a second implementation. A turn is
 * some text and some tool calls. That is all either vendor is asked for, and
 * all either one may contribute.
 *
 * Three things are NOT in this contract, on purpose:
 *
 *   a stop reason   Whether to run tools is decided by whether tool calls
 *                   arrived, not by a vendor's word for why it stopped. One
 *                   fewer concept to map, and no way for the two to disagree.
 *   reasoning       Neither adapter may emit it. There is no event for it, so
 *                   forwarding it would mean changing this file first.
 *   a credential    An adapter is handed the one key it needs. It never reads
 *                   the environment and never sees the other provider's.
 *
 * Isomorphic: no server-only import and no SDK import, so the tests can hold
 * these shapes without either vendor's package.
 */

export type ProviderName = "anthropic" | "openai";

export const PROVIDER_NAMES: readonly ProviderName[] = ["anthropic", "openai"];

/** One tool call the model asked for, in FortMark's words. */
export interface NeutralToolCall {
  id: string;
  name: string;
  input: unknown;
  /** The arguments did not survive JSON.parse. Recorded, never guessed at. */
  invalid?: boolean;
}

/** One executed tool, on its way back to the model. */
export interface NeutralToolResult {
  id: string;
  name: string;
  /** The JSON the executor produced. Opaque to the adapter. */
  payload: string;
  isError: boolean;
}

/**
 * The conversation, in FortMark's own vocabulary.
 *
 * The loop builds this and each adapter renders it into its vendor's shape.
 * Neither vendor's message format leaks upwards, so adding a third provider
 * is a new render function rather than a new history type.
 */
export type NeutralTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: NeutralToolCall[] }
  | { role: "tool_results"; results: NeutralToolResult[] };

/**
 * What a round can produce.
 *
 * Text reaches the user. A tool call reaches the executor. There is no third
 * kind, which is what makes "the UI never learns which vendor answered" a
 * property of the type system rather than a promise.
 */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: NeutralToolCall };

/** A round that has been started and is known to be live. */
export interface OpenedRound {
  events: AsyncIterator<TurnEvent>;
  /** Stop generating. Called when the reader goes away or the loop gives up. */
  abort: () => void;
}

export interface RoundOptions {
  /**
   * False on the final round: the model is told it may not call anything
   * further, so the turn ends in an answer rather than in a request the budget
   * cannot pay for. Every adapter must honour this with its vendor's own
   * mechanism — it is a FortMark limit, not a hint.
   */
  allowTools: boolean;
}

/**
 * Why a provider call failed, in terms the route can map to a status.
 *
 * Vendor error classes never travel past the adapter, and neither do vendor
 * messages: they carry request ids, account identifiers and sometimes the
 * request itself.
 */
export type ProviderFailureKind =
  | "cancelled"
  | "rate_limited"
  | "auth"
  | "bad_request"
  | "unavailable";

/**
 * One vendor, as FortMark uses it.
 *
 * `openRound` resolves only once the underlying stream is known to be live —
 * it awaits the first wire event before returning. That is what keeps the HTTP
 * status honest: once a 200 and its headers are on the wire they cannot be
 * corrected, so a rejected key or a rate limit has to surface before the
 * response starts. Each adapter owns that pre-flight because each vendor's
 * stream opens differently.
 */
export interface AiProvider {
  readonly name: ProviderName;
  readonly model: string;
  openRound: (turns: NeutralTurn[], options: RoundOptions) => Promise<OpenedRound>;
  /** Map a thrown SDK error onto a neutral kind. Never forwards its message. */
  classify: (error: unknown) => ProviderFailureKind;
}
