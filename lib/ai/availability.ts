import "server-only";

/**
 * Whether the assistant can actually answer, and what to say when it cannot.
 *
 * There used to be a third possibility here, and removing it is the point of
 * this file. An environment without a provider key served a generated reply
 * that opened with a comparable-sales table: invented addresses, invented
 * closed prices, invented days on market, rendered in the same bubble a real
 * answer renders in. That was the right thing for exercising a thread UI and
 * exactly the wrong thing to leave reachable, because nothing on screen said
 * it was fiction and an agent could have taken a price to a seller from it.
 *
 * So there are now two states and no fallback. Either a real model answers
 * over real records, or the surface says it is not connected. A dashboard that
 * says "not available here" is useful; one that invents a comp set is not.
 */
import type { EnvLike } from "../flags.ts";
import { resolveAiCredential } from "./provider.ts";

export type AssistantAvailability = "available" | "not_configured";

export function assistantAvailability(env: EnvLike = process.env): AssistantAvailability {
  return resolveAiCredential(env).ok ? "available" : "not_configured";
}
