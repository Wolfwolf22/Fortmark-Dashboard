import "server-only";

/**
 * Whether the assistant can actually answer, which vendor would, and what to
 * say when it cannot.
 *
 * There used to be a third possibility here, and removing it is still the
 * point of this file. An environment without a provider key served a generated
 * reply that opened with a comparable-sales table: invented addresses,
 * invented closed prices, invented days on market, rendered in the same bubble
 * a real answer renders in. Nothing on screen said it was fiction and an agent
 * could have taken a price to a seller from it.
 *
 * So there is no fallback of any kind — and with two vendors that now means
 * two rules, not one. A real model answers over real records, or the surface
 * says it is not connected. And the vendor that answers is the vendor that was
 * selected: a missing Anthropic key never means OpenAI quietly answers, or the
 * reverse.
 */
import type { EnvLike } from "../flags.ts";
import {
  aiProviderEnabled,
  parseProvider,
  resolveProvider,
  selectedModel,
} from "./providers/select.ts";
import type { ProviderName } from "./providers/types.ts";

export type AssistantStatus =
  | "available"
  | "disabled"
  | "invalid_provider"
  | "no_credential";

export interface AssistantHealth {
  /** The selected vendor, or null when the selection itself is unreadable. */
  provider: ProviderName | null;
  /**
   * The model that vendor would be asked for, or null when no vendor parses.
   *
   * Not a secret — a model name identifies a product, not an account — and
   * without it a certification cannot state what it certified. It comes from
   * the same helper the runtime uses, so the probe cannot name one model while
   * a turn uses another.
   */
  model: string | null;
  status: AssistantStatus;
}

/**
 * The assistant's state, for an operator.
 *
 * The checks run in a deliberately different order from the gate in
 * `resolveProvider`. The gate looks at the flag first and never reads a
 * credential when the assistant is switched off, which is right for a gate and
 * useless for a report: it would answer "disabled" to an operator whose key is
 * also missing, who would switch it on and come straight back for the second
 * half. This names the step that would still be blocking afterwards.
 *
 * No secret is disclosed by any of it. No value, no variable content and no
 * fragment of a key — only which vendor is selected and which of the setup
 * steps has not been done, which is exactly what a readiness probe is for.
 */
export function assistantHealth(env: EnvLike = process.env): AssistantHealth {
  const provider = parseProvider(env);
  if (!provider) return { provider: null, model: null, status: "invalid_provider" };
  const model = selectedModel(provider, env);

  // The selected vendor's credential, and never the other one's: reporting
  // "available" because some other vendor's key happens to be present would
  // be the same lie as answering with it.
  if (!resolveProvider({ ...env, AI_CHAT_PROVIDER_ENABLED: "1" }).ok) {
    return { provider, model, status: "no_credential" };
  }
  if (!aiProviderEnabled(env)) return { provider, model, status: "disabled" };
  return { provider, model, status: "available" };
}
