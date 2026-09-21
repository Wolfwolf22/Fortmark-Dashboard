import "server-only";

/**
 * Which vendor answers, and with which credential.
 *
 * Server-only by import guard: both keys are read here and neither may ever
 * reach a browser bundle. There is no `NEXT_PUBLIC_` variable in this
 * subsystem and no path by which a browser can influence the choice — the
 * composer's `mode` field is still not read, and a caller-chosen provider
 * would be a caller-chosen bill.
 *
 * The selection is exclusive and fails closed. If `AI_PROVIDER=anthropic` and
 * the Anthropic key is absent, the assistant is unavailable — it does NOT
 * quietly use OpenAI because a key for it happens to be lying around, and the
 * reverse is equally forbidden. Certification has to know which vendor
 * answered a question; a silent substitution would make every result
 * meaningless, and in ordinary use it would send a brokerage's client records
 * to a company nobody chose.
 *
 * That rule has a structural consequence worth stating: this module reads the
 * selected provider's key and never looks at the other one.
 */
import type { EnvLike } from "../../flags.ts";
import { PROVIDER_NAMES, type ProviderName } from "./types.ts";

/**
 * The default model per vendor, chosen here rather than scattered through the
 * adapters, and overridable per deployment with `AI_MODEL`.
 *
 * Both are the current flagship of their family. They are deliberate choices
 * and are documented in `docs/AI_PROVIDERS.md`; a deployment that wants
 * something cheaper or faster sets `AI_MODEL` and changes nothing else.
 */
export const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.5",
};

/**
 * The provider used when `AI_PROVIDER` is not set at all.
 *
 * This is a documented default, not a fallback: it exists so that a
 * deployment configured before this refactor — one that set only
 * `ANTHROPIC_API_KEY` — keeps behaving exactly as it did. An unset variable
 * is not a failed selection. A *wrong* one is, and that is refused.
 */
export const DEFAULT_PROVIDER: ProviderName = "anthropic";

/** The environment variable each vendor's credential lives in. */
export const CREDENTIAL_VARIABLE: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export type SelectionFailure = "disabled" | "invalid_provider" | "no_credential";

export type ProviderSelection =
  | { ok: true; name: ProviderName; model: string; apiKey: string }
  | { ok: false; reason: SelectionFailure; name: ProviderName | null };

/**
 * Parse `AI_PROVIDER`.
 *
 * Unset is the documented default above. Anything else that is not a name we
 * implement is refused outright — never coerced, never lower-cased into a
 * guess, never fallen back from. An operator who typed `AI_PROVIDER=openAI`
 * should be told the value is wrong, not quietly served by the other vendor.
 */
export function parseProvider(env: EnvLike = process.env): ProviderName | null {
  const raw = env.AI_PROVIDER?.trim();
  if (!raw) return DEFAULT_PROVIDER;
  return (PROVIDER_NAMES as readonly string[]).includes(raw) ? (raw as ProviderName) : null;
}

/**
 * Permit calls to a paid provider at all.
 *
 * A separate gate from credential presence, for the reason every integration
 * flag in this codebase is separate: a credential can arrive in an environment
 * for another purpose, and if presence were the switch, adding one would start
 * billed traffic without anyone choosing to.
 *
 * Strict — only the exact string "1" — because it authorises spending against
 * an external account, and a typo should fail closed rather than be guessed
 * generously.
 */
export function aiProviderEnabled(env: EnvLike = process.env): boolean {
  return env.AI_CHAT_PROVIDER_ENABLED === "1";
}

/**
 * Resolve the vendor, the model and the key this request may use.
 *
 * Gate order: the flag first, so an environment with the assistant switched
 * off never reads a credential at all; then the vendor name; then that
 * vendor's key and nobody else's.
 *
 * It authorises no one. Clerk authentication and the dashboard allowlist are
 * enforced by the route ahead of all of this.
 */
export function resolveProvider(env: EnvLike = process.env): ProviderSelection {
  if (!aiProviderEnabled(env)) return { ok: false, reason: "disabled", name: parseProvider(env) };

  const name = parseProvider(env);
  if (!name) return { ok: false, reason: "invalid_provider", name: null };

  const apiKey = env[CREDENTIAL_VARIABLE[name]]?.trim();
  if (!apiKey) return { ok: false, reason: "no_credential", name };

  return { ok: true, name, model: env.AI_MODEL?.trim() || DEFAULT_MODEL[name], apiKey };
}
