import "server-only";

/**
 * Minimal client for the Bridge Data Output RESO Web API (OData).
 *
 * Ported from the FortMark MCP server's `lib/bridge.ts` so the dashboard and
 * the MCP hit the dataset the same way. Two rules carried over unchanged:
 *
 *   - The token NEVER appears in a URL, a log line, or an error message. It
 *     travels only in the Authorization header.
 *   - `$top` is capped on every request, whatever the caller asked for.
 *
 * Added here: a request deadline, and a typed failure so a route can answer
 * with an accurate status and the UI can say what actually went wrong.
 */
import type { BridgeConfig } from "./config.ts";

/** Hard cap on `$top` enforced on every request. Same figure as the MCP. */
export const MAX_TOP = 200;

/** Bridge responds in well under this on a healthy day; beyond it the
 *  listings screen is better served by an honest error than a spinner. */
export const REQUEST_TIMEOUT_MS = 12_000;

export interface ODataParams {
  $filter?: string;
  $select?: string;
  $orderby?: string;
  $expand?: string;
  $top?: number;
  $skip?: number;
  $count?: boolean;
}

export interface BridgePage<T = Record<string, unknown>> {
  /** Server-side total for the filter, when `$count=true` was honoured. */
  count: number | null;
  value: T[];
  nextLink: string | null;
}

export type BridgeFailureKind =
  /** 401/403 — the credential was rejected. Ours to fix, never the caller's. */
  | "unauthorized"
  /** 400 — the query was rejected, typically an unknown field or operator. */
  | "bad_request"
  /** 429 — slow down. */
  | "rate_limited"
  /** Any other non-2xx. */
  | "upstream"
  /** The deadline passed. */
  | "timeout"
  /** No response at all. */
  | "network";

/**
 * A failed Bridge call, classified.
 *
 * `message` is safe to log: it carries the status and resource, never the
 * token, never the full response body. `detail` holds a short bounded slice
 * of the body for a server log line only — it must not be sent to a browser.
 */
export class BridgeError extends Error {
  readonly kind: BridgeFailureKind;
  readonly status: number | null;
  readonly resource: string;
  readonly detail: string;

  constructor(kind: BridgeFailureKind, resource: string, status: number | null, detail = "") {
    super(
      status === null
        ? `Bridge ${kind} for ${resource}`
        : `Bridge ${kind} (${status}) for ${resource}`
    );
    this.name = "BridgeError";
    this.kind = kind;
    this.status = status;
    this.resource = resource;
    this.detail = detail;
  }
}

function classify(status: number): BridgeFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 400) return "bad_request";
  if (status === 429) return "rate_limited";
  return "upstream";
}

/**
 * GET `{base}/{dataset}/{resource}` with the given OData params.
 *
 * The caller's `signal` (a client disconnect) is combined with the deadline
 * so that either ends the upstream request.
 */
export async function bridgeRequest<T = Record<string, unknown>>(
  config: BridgeConfig,
  resource: string,
  params: ODataParams = {},
  signal?: AbortSignal
): Promise<BridgePage<T>> {
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const value = key === "$top" ? Math.min(Math.max(Number(raw) || 0, 0), MAX_TOP) : raw;
    search.set(key, String(value));
  }
  const qs = search.toString();
  const url =
    `${config.baseUrl}/${encodeURIComponent(config.dataset)}/${encodeURIComponent(resource)}` +
    (qs ? `?${qs}` : "");

  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal: combined,
      cache: "no-store",
    });
  } catch (error) {
    if (deadline.aborted) throw new BridgeError("timeout", resource, null);
    if (signal?.aborted) throw error; // the caller hung up; not a Bridge fault
    throw new BridgeError("network", resource, null);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      detail = "";
    }
    throw new BridgeError(classify(res.status), resource, res.status, detail);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const value = Array.isArray(json.value) ? (json.value as T[]) : [];
  return {
    count: typeof json["@odata.count"] === "number" ? (json["@odata.count"] as number) : null,
    value,
    nextLink: typeof json["@odata.nextLink"] === "string" ? (json["@odata.nextLink"] as string) : null,
  };
}
