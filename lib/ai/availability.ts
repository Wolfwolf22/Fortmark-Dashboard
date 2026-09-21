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

/**
 * The two halves are reported separately, because they are two different jobs.
 *
 *   available      a model answers, over this caller's real records.
 *   not_enabled    nobody has switched the assistant on in this environment.
 *   no_credential  someone switched it on and the key never arrived. This is
 *                  a misconfiguration, not a choice, and it is the one an
 *                  operator can act on immediately.
 *
 * Neither label is a secret. No value, no variable content and no fragment of
 * a key is disclosed — only which of two setup steps has not been done, which
 * is exactly what a readiness probe exists to say. Collapsing both into one
 * word cost an operator a build log to find out which.
 */
export type AssistantAvailability = "available" | "not_enabled" | "no_credential";

export function assistantAvailability(env: EnvLike = process.env): AssistantAvailability {
  if (resolveAiCredential(env).ok) return "available";
  // Deliberately checked in the opposite order to the gate. `resolveAiCredential`
  // looks at the flag first and never reads the key when the assistant is
  // switched off, which is right for a gate and useless for a report: it would
  // say "not_enabled" to an operator whose key is also missing, who would flip
  // the flag and come straight back for the second half. This names the step
  // that would still be blocking afterwards.
  if (!env.ANTHROPIC_API_KEY?.trim()) return "no_credential";
  return "not_enabled";
}
