import "server-only";

/**
 * MLS configuration for the listings domain.
 *
 * Server-only by import guard: `BRIDGE_API_TOKEN` is read here and must never
 * reach a browser bundle.
 *
 * The dashboard reads the same Bridge Interactive (RESO Web API) dataset the
 * FortMark MCP server does, with its own server-side credential. It does NOT
 * call the MCP server's `/api/mcp`: that endpoint is OAuth-only by documented
 * policy (docs/DEPLOYMENT.md, "MCP boundary") and a dashboard session is not
 * an MCP token. Going to the dataset directly is what that policy asks for —
 * "authenticated Next route → internal service" — with this module as the
 * internal service.
 */
import type { EnvLike } from "../flags.ts";

/** Bridge's public RESO endpoint. Overridable for tests and for a proxy. */
export const DEFAULT_BRIDGE_BASE_URL = "https://api.bridgedataoutput.com/api/v2/OData";

/**
 * Permit MLS-backed listings.
 *
 * A SEPARATE gate from credential presence, for the same reason every other
 * integration flag in this codebase is: a credential can be present in an
 * environment for another purpose, and presence as the switch would make the
 * listings screen change source without anyone choosing to.
 *
 * Strict — only the exact string "1". This one decides whether the listings
 * screen shows the brokerage's actual MLS or the built-in sample set, so a
 * typo should fail closed (sample, plainly labelled) rather than be guessed.
 *
 * Off means the listings domain behaves exactly as it does today: the seeded
 * sample generators, labelled as such in the UI.
 */
export function mlsListingsEnabled(env: EnvLike = process.env): boolean {
  return env.MLS_LISTINGS_ENABLED === "1";
}

export interface BridgeConfig {
  baseUrl: string;
  dataset: string;
  token: string;
}

export type BridgeConfigResult =
  | { ok: true; config: BridgeConfig }
  | { ok: false; reason: "disabled" | "missing_token" | "missing_dataset" };

/**
 * Resolve the credential and dataset this subsystem is allowed to use.
 *
 * Returned rather than read ambiently by the client so "is the MLS
 * configured" is answered in one place, and so the value the client is
 * later constructed with is the value that was checked.
 */
export function resolveBridgeConfig(env: EnvLike = process.env): BridgeConfigResult {
  if (!mlsListingsEnabled(env)) return { ok: false, reason: "disabled" };
  const token = env.BRIDGE_API_TOKEN?.trim();
  if (!token) return { ok: false, reason: "missing_token" };
  const dataset = env.BRIDGE_DATASET?.trim();
  if (!dataset) return { ok: false, reason: "missing_dataset" };
  const baseUrl = (env.BRIDGE_BASE_URL?.trim() || DEFAULT_BRIDGE_BASE_URL).replace(/\/+$/, "");
  return { ok: true, config: { baseUrl, dataset, token } };
}

/**
 * Permit the generated listing set.
 *
 * This flag did not exist, and its absence was a lie the dashboard told.
 * `listingSource()` used to return "sample" for every reason the MLS was not
 * configured, so a deployment that had simply never been given a Bridge
 * credential served invented properties — with invented addresses, prices and
 * photographs — through the same screens, the same adapter and the same
 * `/api/health` label that a working MLS would use. Nothing chose that. It
 * was the default.
 *
 * Generated listings are now something a deployment opts into, by name, the
 * same way Home's sample brokerage is. Strict — only the exact string "1" —
 * because it makes the product state things that are not true, and a flag
 * like that should never be switched on by a generous reading of a typo.
 *
 * It never overrides a live MLS: where Bridge is configured, real listings
 * win and this flag changes nothing.
 */
export function sampleListingsEnabled(env: EnvLike = process.env): boolean {
  return env.SAMPLE_LISTINGS_ENABLED === "1";
}

/**
 * What this deployment can actually show on a listings screen.
 *
 *   mls             Bridge is configured. Rows are the brokerage's own MLS.
 *   sample          fixture mode is explicitly on. Rows are generated, and
 *                   every screen that shows them says so.
 *   not_configured  no MLS, no fixture mode. There are no listings to show,
 *                   and the screens say that rather than inventing some.
 *
 * Note what is NOT here: `unavailable`. That is the outcome of a call, not a
 * property of the configuration, and this function does not make one. A
 * Bridge that is configured but failing is reported as `unavailable` by the
 * thing that actually tried — the listings routes, the search provider, the
 * metrics service — each of which knows because its own request failed.
 * Probing Bridge from an unauthenticated health endpoint would turn a
 * readiness check into a billable upstream request that anyone could trigger,
 * so this reports what is configured and says so plainly.
 */
export type ListingAvailability = "mls" | "sample" | "not_configured";

export function listingAvailability(env: EnvLike = process.env): ListingAvailability {
  if (resolveBridgeConfig(env).ok) return "mls";
  if (sampleListingsEnabled(env)) return "sample";
  return "not_configured";
}
