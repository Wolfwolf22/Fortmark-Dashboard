/**
 * The contract every FortMark AI tool obeys.
 *
 * Three rules shape this file, and none of them is negotiable.
 *
 * **No tool changes a record.** A tool either reads, or it proposes — and
 * `ToolEffect` has exactly those two members. There is no create, update,
 * delete, send or upload here, and none is added "for later": a mutation tool
 * that exists is a mutation tool the model can call. A proposing tool writes
 * only to `ai_prepared_actions`, which is a row describing a change that has
 * not happened and will not happen until a person confirms it through a route
 * no tool can name. Executing is not an effect a tool can declare, so an
 * execution tool cannot be expressed here without changing this type first —
 * which is the review gate.
 *
 * **The model cannot choose its own authorization scope.** A tool receives a
 * `ToolContext` carrying the *verified* Clerk user id and nothing else about
 * identity. Arguments never carry a brokerage, an agent, a role or a scope;
 * every tool resolves the actor itself through the same `resolveActor` the
 * screens use, and every query then runs under the same `visibleTo` predicate.
 * A model that asks for another brokerage's records is not refused — it has no
 * way to ask.
 *
 * **A failure is never an empty answer.** `ToolOutcome` distinguishes "this
 * domain is not connected" from "the caller may not see this" from "the query
 * failed" from "there is nothing". A tool that cannot look must never return
 * an empty list, because the model would report it as "you have none".
 *
 * Isomorphic: no server-only import, so the tests can hold these shapes.
 */
import type { EnvLike } from "../../flags.ts";

/** The identity and moment a tool call runs under. Supplied by the server. */
export interface ToolContext {
  /** From the verified Clerk session. Never from the model, never from a body. */
  clerkUserId: string;
  env: EnvLike;
  now: Date;
  /**
   * Correlates one turn's log lines, so a trace reads as a route rather than
   * as unrelated calls interleaved with every other request the instance is
   * serving:
   *
   *     [ai] turn=7f3a1c9b round=1 tools=1
   *     [ai] turn=7f3a1c9b tool=search_entities ok=true ms=84
   *     [ai] turn=7f3a1c9b round=2 tools=1
   *     [ai] turn=7f3a1c9b tool=get_transaction ok=true ms=41
   *
   * Random per request and never derived from the user, the session or the
   * message, so it identifies a turn to an operator reading a log and nothing
   * to anyone else. It is not a session id and is never persisted.
   */
  traceId: string;
}

/**
 * Why a tool could not answer.
 *
 * Each maps to a sentence the model is instructed to say plainly rather than
 * paper over. `not_found` deliberately covers both "no such record" and "not
 * yours": the two must be indistinguishable, or the absence of an error
 * becomes a way to confirm that another brokerage's record exists.
 */
export type ToolErrorCode =
  | "invalid_arguments"
  | "not_found"
  | "not_configured"
  | "not_permitted"
  | "unavailable"
  | "timeout"
  | "too_many_calls"
  | "unknown_tool";

/** What each code means, in the words the model should use. Static text. */
export const TOOL_ERROR_MEANING: Record<ToolErrorCode, string> = {
  invalid_arguments: "The arguments did not match this tool's schema.",
  not_found: "No such record is visible to this user.",
  not_configured: "This data source is not connected in this deployment.",
  not_permitted: "This user's role may not see this.",
  unavailable: "The data source could not be reached. This is not an empty result.",
  timeout: "The lookup took too long. This is not an empty result.",
  too_many_calls: "Too many tools were requested at once. Ask for fewer.",
  unknown_tool: "No such tool exists.",
};

export type ToolOutcome<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolErrorCode };

export const ok = <T>(data: T): ToolOutcome<T> => ({ ok: true, data });
export const fail = <T = never>(error: ToolErrorCode): ToolOutcome<T> => ({ ok: false, error });

/**
 * What a tool is permitted to do.
 *
 * `read` answers a question and leaves the database as it found it.
 * `propose` additionally writes one `ai_prepared_actions` row: a described,
 * expiring, single-use proposal that changes nothing until a human confirms
 * it. There is deliberately no third member — see the header.
 */
export type ToolEffect = "read" | "propose";

/**
 * One tool.
 *
 * `schema` is the single source of truth for what the model may send: the
 * JSON Schema the provider sees is derived from it, and the same schema
 * validates the arguments that come back. There is no path where a tool runs
 * on an argument object that was not parsed by its own schema.
 */
export interface FortmarkTool<A = unknown, R = unknown> {
  name: string;
  /** Declared, not inferred. Asserted by `scripts/test_ai_tools.ts`. */
  effect: ToolEffect;
  /** Written for the model: what it answers, and what it deliberately does not. */
  description: string;
  /** Parses and narrows the model's arguments. Rejection is a tool error. */
  parse: (input: unknown) => { ok: true; value: A } | { ok: false };
  /** The provider-facing JSON Schema, derived from the same definition. */
  inputSchema: Record<string, unknown>;
  run: (args: A, ctx: ToolContext) => Promise<ToolOutcome<R>>;
}

/** How long any one tool may take before it is reported as unavailable. */
export const TOOL_TIMEOUT_MS = 8_000;

/** How many tools may run in one round. The model is told to ask for fewer. */
export const MAX_TOOL_CALLS_PER_ROUND = 4;

/** Result caps. The assistant is a colleague answering a question, not a report. */
export const TOOL_LIMITS = {
  defaultRows: 8,
  maxRows: 20,
  defaultSearch: 8,
  maxSearch: 10,
} as const;
