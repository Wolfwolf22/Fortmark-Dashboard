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
 * Where the listings screen gets its rows from.
 *
 * `sample` is the seeded generator set that the dashboard has always shown.
 * It is reported to the browser by name so the UI can label it — sample rows
 * must never be mistaken for the brokerage's MLS.
 */
export type ListingSource = "mls" | "sample";

export function listingSource(env: EnvLike = process.env): ListingSource {
  return resolveBridgeConfig(env).ok ? "mls" : "sample";
}
