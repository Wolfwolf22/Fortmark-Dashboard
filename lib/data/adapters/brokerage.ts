/**
 * Brokerage identity adapter.
 *
 * The server decides the source (`/api/brokerage`): the brokerage's stored
 * identity (possibly not yet configured), the labelled fixture in explicit
 * sample mode, or not configured. This adapter reports what it was told and
 * never substitutes generated office details for a failed read.
 */
import { apiPath } from "@/lib/routes";
import type { BrokerageField, BrokerageResponse, BrokerageValues } from "@/lib/brokerage/identity";
import type { BrokerageProfile } from "../types";
import { getBrokerage } from "./settings";
import { SubsystemUnavailableError } from "./subsystems";

export type BrokerageState =
  | ({ source: "db" } & BrokerageResponse)
  | { source: "sample"; profile: BrokerageProfile };

export class BrokerageError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The brokerage details could not be read (${status}).`);
    this.name = "BrokerageError";
    this.status = status;
  }
}

export type BrokerageFieldErrors = Partial<Record<BrokerageField | "_form", string>>;

export type SaveBrokerageResult =
  | { ok: true; state: BrokerageResponse }
  | { ok: false; status: number; fieldErrors: BrokerageFieldErrors };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isResponse(body: Record<string, unknown>): body is Record<string, unknown> & BrokerageResponse {
  return "identity" in body && typeof body.canEdit === "boolean";
}

export async function getBrokerageState(): Promise<BrokerageState> {
  const response = await fetch(apiPath("/api/brokerage"), { headers: { Accept: "application/json" } });
  const body = await readJson(response);
  if (response.status === 503 && body.error === "not_configured") {
    throw new SubsystemUnavailableError("brokerage");
  }
  if (!response.ok) throw new BrokerageError(response.status);
  if (body.source === "sample") return { source: "sample", profile: await getBrokerage() };
  if (isResponse(body)) {
    return { source: "db", identity: body.identity, canEdit: body.canEdit, mlsOffice: body.mlsOffice ?? null };
  }
  throw new BrokerageError(response.status);
}

/** Save the brokerage's identity. Only brokerage fields are ever sent. */
export async function saveBrokerageIdentity(values: BrokerageValues): Promise<SaveBrokerageResult> {
  const response = await fetch(apiPath("/api/brokerage"), {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const body = await readJson(response);
  if (response.ok && isResponse(body)) {
    return { ok: true, state: { identity: body.identity, canEdit: body.canEdit, mlsOffice: body.mlsOffice ?? null } };
  }
  if (response.status === 400 && body.fieldErrors && typeof body.fieldErrors === "object") {
    return { ok: false, status: 400, fieldErrors: body.fieldErrors as BrokerageFieldErrors };
  }
  const message =
    response.status === 403
      ? "Only a broker or admin can change the brokerage's details."
      : "The brokerage details could not be saved. Try again.";
  return { ok: false, status: response.status, fieldErrors: { _form: message } };
}
