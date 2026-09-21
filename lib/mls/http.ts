import "server-only";

/**
 * HTTP answers for the listings routes.
 *
 * One place decides what a caller is told when the MLS cannot answer, so
 * every route says the same thing for the same fault and none of them
 * forwards an upstream body — Bridge error text can carry the dataset name
 * and request details that are of no use to a browser.
 */
import { NextResponse } from "next/server";
import { BridgeError } from "./bridge.ts";
import { resolveBridgeConfig, type BridgeConfig, type BridgeConfigResult } from "./config.ts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** What the browser is told about a failed MLS call. Coarse on purpose. */
export type ListingsFailure =
  | "mls_unavailable"
  | "mls_rejected_query"
  | "mls_rate_limited"
  | "mls_timeout"
  | "mls_not_configured";

let configFailureReported = false;

/**
 * Resolve the MLS credential, or explain why not.
 *
 * `disabled` is not a failure — it means the sample source is in use, and
 * the route serves that instead. A flag that is ON with a missing credential
 * IS a failure: someone chose the MLS and it cannot be reached. That is
 * reported once per process to the server log, naming the variable and
 * nothing else.
 */
export function mlsConfig(): BridgeConfigResult {
  const result = resolveBridgeConfig();
  if (!result.ok && result.reason !== "disabled" && !configFailureReported) {
    configFailureReported = true;
    console.error(
      result.reason === "missing_token"
        ? "[mls] MLS_LISTINGS_ENABLED=1 but BRIDGE_API_TOKEN is not set. Listings will answer 503 until it is."
        : "[mls] MLS_LISTINGS_ENABLED=1 but BRIDGE_DATASET is not set. Listings will answer 503 until it is."
    );
  }
  return result;
}

export function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: "mls_not_configured" satisfies ListingsFailure },
    { status: 503, headers: NO_STORE }
  );
}

/**
 * Map a thrown failure to a response. A rejected credential is logged as a
 * server fault (ours to fix); a rejected query is logged with the resource
 * and the bounded detail so an unknown-field mistake can be found; nothing
 * upstream-authored reaches the browser.
 */
export function failureResponse(error: unknown): NextResponse {
  if (error instanceof BridgeError) {
    switch (error.kind) {
      case "unauthorized":
        console.error(`[mls] the MLS rejected BRIDGE_API_TOKEN (${error.status}). Listings are unavailable until a valid token is set.`);
        return json("mls_unavailable", 503);
      case "bad_request":
        console.error(`[mls] the MLS rejected a query for ${error.resource}: ${error.detail}`);
        return json("mls_rejected_query", 502);
      case "rate_limited":
        return json("mls_rate_limited", 429);
      case "timeout":
        return json("mls_timeout", 504);
      default:
        console.error(`[mls] ${error.message}`);
        return json("mls_unavailable", 503);
    }
  }
  // A client disconnect surfaces as an AbortError; there is nobody to answer.
  if (error instanceof Error && error.name === "AbortError") {
    return json("mls_timeout", 499);
  }
  console.error("[mls] unexpected failure in a listings route");
  return json("mls_unavailable", 503);
}

function json(error: ListingsFailure, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export type { BridgeConfig };
