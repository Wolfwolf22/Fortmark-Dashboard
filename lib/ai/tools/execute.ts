import "server-only";

/**
 * Running a tool the model asked for.
 *
 * The model requests; the server decides and executes. Between the request and
 * the domain service sit four checks, in this order:
 *
 *   1. the name must be in the registry — an unknown name is an error, not a guess;
 *   2. the arguments must parse against that tool's own schema;
 *   3. the call must finish inside `TOOL_TIMEOUT_MS`;
 *   4. a thrown query becomes `unavailable`, never an empty result.
 *
 * No credential is handed out here. The model never sees a database URL, an
 * MLS token or an API key; it sees the name of a tool and the shape of its
 * result, and the server holds everything else.
 *
 * Logging is deliberately thin: the tool's name, whether it succeeded, and how
 * long it took. Never the arguments — they contain client names — and never
 * the result, which is the record itself.
 */
import { findTool } from "./registry.ts";
import type { ReadOnlyTool } from "./types.ts";
import {
  MAX_TOOL_CALLS_PER_ROUND,
  TOOL_ERROR_MEANING,
  TOOL_TIMEOUT_MS,
  type ToolContext,
  type ToolErrorCode,
  type ToolOutcome,
} from "./types.ts";

/** What the model asked for, taken from one `tool_use` block. */
export interface ToolRequest {
  id: string;
  name: string;
  /** Raw, unvalidated. It has been through JSON.parse and nothing else. */
  input: unknown;
  /** True when the provider's arguments were not valid JSON. */
  invalid?: boolean;
}

/** One executed call, ready to become a `tool_result` block. */
export interface ToolExecution {
  id: string;
  name: string;
  outcome: ToolOutcome;
  ms: number;
}

/**
 * How a tool name is resolved, and how long it may take.
 *
 * Defaulted to the real registry and the real ceiling. It is a parameter so
 * the failure paths — a tool that throws, a tool that never returns — can be
 * exercised without a provider, a database or an eight-second wait; nothing in
 * the application passes anything but the defaults.
 */
export interface ExecuteOptions {
  tools?: (name: string) => ReadOnlyTool<never, unknown> | undefined;
  timeoutMs?: number;
}

/** Reject a promise that overstays. The domain call is abandoned, not awaited. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute one requested tool.
 *
 * Every failure path returns a structured outcome rather than throwing: the
 * model is owed an answer it can report honestly, and an exception escaping
 * here would end the turn mid-sentence instead.
 */
export async function executeTool(
  request: ToolRequest,
  ctx: ToolContext,
  options: ExecuteOptions = {}
): Promise<ToolExecution> {
  const started = Date.now();
  const done = (outcome: ToolOutcome): ToolExecution => {
    const ms = Date.now() - started;
    // Name, verdict, duration. Nothing that identifies a person or a property.
    console.info(
      `[ai] turn=${ctx.traceId} tool=${request.name} ok=${outcome.ok} ms=${ms}` +
        (outcome.ok ? "" : ` reason=${outcome.error}`)
    );
    return { id: request.id, name: request.name, outcome, ms };
  };

  const tool = (options.tools ?? findTool)(request.name);
  if (!tool) return done({ ok: false, error: "unknown_tool" });
  if (request.invalid) return done({ ok: false, error: "invalid_arguments" });

  const parsed = tool.parse(request.input);
  if (!parsed.ok) return done({ ok: false, error: "invalid_arguments" });

  try {
    const outcome = await withTimeout(tool.run(parsed.value, ctx), options.timeoutMs ?? TOOL_TIMEOUT_MS);
    if (outcome === "timeout") return done({ ok: false, error: "timeout" });
    return done(outcome);
  } catch {
    // The provider's or the database's message is never forwarded: it can
    // carry connection strings, request ids and account identifiers.
    return done({ ok: false, error: "unavailable" });
  }
}

/**
 * Execute one round's worth of requests.
 *
 * They run together because the model asked for them together, but the number
 * is bounded: a round that asks for more than `MAX_TOOL_CALLS_PER_ROUND` gets
 * the surplus back as a refusal it can act on, rather than the server quietly
 * doing unbounded work on the model's say-so.
 */
export async function executeRound(
  requests: ToolRequest[],
  ctx: ToolContext,
  options: ExecuteOptions = {}
): Promise<ToolExecution[]> {
  const allowed = requests.slice(0, MAX_TOOL_CALLS_PER_ROUND);
  const refused = requests.slice(MAX_TOOL_CALLS_PER_ROUND);
  const run = await Promise.all(allowed.map((request) => executeTool(request, ctx, options)));
  return [
    ...run,
    ...refused.map((request) => ({
      id: request.id,
      name: request.name,
      outcome: { ok: false as const, error: "too_many_calls" as ToolErrorCode },
      ms: 0,
    })),
  ];
}

/**
 * What one execution looks like on the wire back to the model.
 *
 * A failure carries a code and the sentence that code means, so the model
 * reports "the transactions database could not be reached" rather than
 * inventing a plausible number or saying the user has no deals.
 */
export function toolResultPayload(execution: ToolExecution): string {
  if (execution.outcome.ok) return JSON.stringify(execution.outcome.data);
  return JSON.stringify({
    error: execution.outcome.error,
    meaning: TOOL_ERROR_MEANING[execution.outcome.error],
  });
}
