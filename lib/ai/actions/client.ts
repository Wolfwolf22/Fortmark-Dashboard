/**
 * The browser's view of prepared actions.
 *
 * The one rule that shapes this file: **an action card is built from what the
 * server says, never from what the model said.** The chat stream is plain
 * text, and text produced by a model is not authority — it may describe a
 * proposal that was never prepared, or misdescribe one that was. So when a
 * turn ends the thread asks this API what is actually pending, and renders
 * that. A model can talk about scheduling anything it likes; the card appears
 * only if a row exists, and says only what the row says.
 *
 * (A framed protocol — NDJSON on the chat stream, with the action delivered
 * as its own frame — would let the card appear without a second request. It
 * is the natural refinement once more than one action type exists, and it is
 * deliberately not F2-B's job: this way the authoritative payload is fetched
 * over an authenticated route rather than parsed out of a stream the model
 * also writes into.)
 */
import { apiPath } from "@/lib/routes";
import type { PreparedAction } from "./contract";

/** A prepared action could not be acted on, with the reason a person needs. */
export class ActionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? "That could not be completed. Try again.");
    this.name = "ActionError";
    this.code = code;
  }
}

/**
 * Why a confirmation was refused, in the words the card shows.
 *
 * "Expired", "already done" and "the record changed" are three genuinely
 * different situations, and only one of them means try again — so they are
 * never collapsed into one apology.
 */
const MESSAGES: Record<string, string> = {
  expired: "This suggestion expired before it was confirmed. Ask again to prepare a new one.",
  stale: "This contact's follow-up changed after this was prepared, so it was not applied. Ask again to prepare a new one.",
  cancelled: "This suggestion was already declined.",
  in_progress: "This is already being confirmed.",
  no_identity: "Your account is not set up to make changes yet.",
  "404": "This suggestion is no longer available.",
  "401": "Your session has expired. Sign in again.",
  "403": "Your account is not approved for this.",
};

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : String(response.status);
  } catch {
    return String(response.status);
  }
}

/**
 * What is waiting for this user.
 *
 * Returns an empty list rather than throwing when the deployment has actions
 * switched off: a thread with no cards is the correct rendering of "this
 * build cannot prepare actions", and an error banner would be noise on a
 * screen where nothing was attempted.
 */
export async function fetchPendingActions(signal?: AbortSignal): Promise<PreparedAction[]> {
  const response = await fetch(apiPath("/api/ai/actions"), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { actions?: PreparedAction[] };
  return Array.isArray(body.actions) ? body.actions : [];
}

/**
 * Commit one proposal.
 *
 * The id is the entire request. There is no field here for a date, a contact
 * or a scope, because nothing the browser could send is allowed to influence
 * what happens — the server re-reads all of it.
 */
export async function confirmAction(actionId: string): Promise<{ action: PreparedAction; alreadyExecuted: boolean }> {
  const response = await fetch(apiPath(`/api/ai/actions/${encodeURIComponent(actionId)}/execute`), {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new ActionError(await errorCode(response));
  return (await response.json()) as { action: PreparedAction; alreadyExecuted: boolean };
}

/** Decline one proposal. Recorded server-side, not dismissed in the browser. */
export async function declineAction(actionId: string): Promise<void> {
  const response = await fetch(apiPath(`/api/ai/actions/${encodeURIComponent(actionId)}/cancel`), {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new ActionError(await errorCode(response));
}
