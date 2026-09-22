import "server-only";

/**
 * One pending proposal per identical request.
 *
 * Certification watched the model, told "yes" after a follow-up card, call
 * the prepare tool a second time. Two identical cards appeared, the pending
 * list held both, and the person had two Confirm buttons for one change.
 * Nothing unsafe happened — confirming either applies the change once, and
 * typing "yes" still changed nothing — but "which of these two do I press"
 * is not a question a confirmation surface may ask.
 *
 * The invariant belongs on the server, not in a prompt. A model that retries,
 * a double-tapped button and two browser tabs are the same event from this
 * module's point of view, and a rule the model is asked to remember is a rule
 * that holds until the model forgets.
 *
 * **Identity** is every input that decides what would happen: the tenant, the
 * actor, the action type, the target, the instruction, and the fingerprint of
 * the record state the proposal was computed against. The fingerprint is what
 * makes staleness fall out for free — if the contact moved, the new proposal
 * hashes differently and is prepared rather than reused, which is right,
 * because the old one would refuse at execution anyway.
 */
import { createHash } from "node:crypto";

/**
 * JSON with keys in a fixed order, recursively.
 *
 * `{a:1,b:2}` and `{b:2,a:1}` are the same instruction and must hash the
 * same. The payloads this is given are small and flat today; the recursion
 * is here so that stays true if one grows.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export interface PendingIdentity {
  brokerageKey: string;
  actorUserId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  expectedFingerprint: string;
}

/**
 * The key a pending row is unique on.
 *
 * Hashed rather than concatenated so the column has a fixed width and so no
 * field value — a stage name, a date, a target id — is readable from an
 * index a person might see in a query plan. Field separators are included in
 * the pre-image so two different splits of the same characters cannot
 * collide.
 */
export function pendingActionKey(identity: PendingIdentity): string {
  const preimage = [
    identity.brokerageKey,
    identity.actorUserId,
    identity.actionType,
    identity.targetType,
    identity.targetId,
    canonical(identity.payload),
    identity.expectedFingerprint,
  ].join("\u0000");
  return createHash("sha256").update(preimage).digest("hex");
}
