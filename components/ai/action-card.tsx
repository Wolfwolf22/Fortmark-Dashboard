"use client";

/**
 * A change the assistant has prepared, and a person has not yet agreed to.
 *
 * Everything rendered here came from the server's own reading of the record —
 * never from the model's prose. That is what makes this a confirmation rather
 * than a transcription: if the assistant says one date in the thread and the
 * row says another, the card shows the row, and confirming applies the row.
 *
 * The design follows from what a person needs in order to consent: what will
 * change, what it is changing from, anything they would regret not knowing,
 * and how long they have. No count-down theatre and no pre-selected default —
 * the two buttons are equally reachable, and doing nothing is a valid outcome
 * that resolves itself when the proposal expires.
 */
import * as React from "react";
import { AlertTriangle, ArrowRight, Check, Clock, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionError, confirmAction, declineAction } from "@/lib/ai/actions/client";
import type { ActionType, PreparedAction } from "@/lib/ai/actions/contract";

/**
 * What the card says once the change has actually been made.
 *
 * Past tense, and specific: "Follow-up scheduled" tells someone what happened;
 * "Success" tells them only that something did. A record keyed by action type
 * means a new action cannot be added without deciding how its completion
 * reads.
 */
const EXECUTED_HEADING: Record<ActionType, string> = {
  contact_followup_schedule: "Follow-up scheduled",
  contact_stage_change: "Stage changed",
  transaction_stage_change: "Transaction stage changed",
  contact_activity_log: "Activity logged",
};

type Settled = "confirmed" | "declined";

export interface ActionCardProps {
  action: PreparedAction;
  /** Told to the thread so the card can be dropped from the pending list. */
  onSettled: (actionId: string, outcome: Settled) => void;
}

export function ActionCard({ action, onSettled }: ActionCardProps) {
  const [busy, setBusy] = React.useState<null | "confirm" | "decline">(null);
  const [settled, setSettled] = React.useState<Settled | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The card holds its own "expired" state so a thread left open does not keep
  // offering a button that cannot work. The server refuses it regardless — this
  // is courtesy, not enforcement.
  const [expired, setExpired] = React.useState(
    () => new Date(action.expiresAt).getTime() <= Date.now()
  );
  React.useEffect(() => {
    if (settled) return;
    const remaining = new Date(action.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [action.expiresAt, settled]);

  async function run(choice: Settled) {
    if (busy || settled) return;
    setBusy(choice === "confirmed" ? "confirm" : "decline");
    setError(null);
    try {
      if (choice === "confirmed") await confirmAction(action.actionId);
      else await declineAction(action.actionId);
      setSettled(choice);
      onSettled(action.actionId, choice);
    } catch (e) {
      // Never report a refused confirmation as success, and never guess at
      // the reason: the server's own wording says which of the several
      // situations this is.
      setError(
        e instanceof ActionError
          ? e.message
          : "That could not be completed. Check your connection and try again."
      );
    } finally {
      setBusy(null);
    }
  }

  const done = settled !== null;

  /**
   * Focus follows the change into its record.
   *
   * Confirm is not disabled and left in place — it is replaced by the record
   * of what it did. Without this the element holding focus simply stops
   * existing, focus falls back to `<body>`, and someone working by keyboard
   * loses their place on the page while the outcome they just authorised goes
   * unannounced. Certification measured exactly that: `activeElement` was
   * BODY after a real Confirm click.
   *
   * `settled` is only ever set by this card's own buttons, so this runs when
   * the person acted and never on incidental re-render.
   */
  const recordRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (settled === "confirmed") recordRef.current?.focus();
  }, [settled]);

  /**
   * What happened, once it has.
   *
   * The proposal scaffolding is gone — the diff arrows, the "nothing changes
   * until you confirm" line and the buttons all described a decision that has
   * now been made. What stays is the record: what was done, to whom, and the
   * value it ended at, so someone scrolling back a week later can still read
   * it. Announced politely because it is the outcome of something the person
   * deliberately pressed, not incidental rendering.
   */
  if (settled === "confirmed") {
    return (
      <div
        ref={recordRef}
        // Focusable on purpose but not in the tab order: it is a destination
        // for the focus its own button gave up, not a new stop for everyone
        // else tabbing through the thread.
        tabIndex={-1}
        className="rounded-panel border border-border bg-card px-4 py-3 text-[13px] shadow-card outline-none dark:shadow-none"
        role="status"
        aria-label="Change confirmed"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <Check aria-hidden className="size-4 flex-none" />
          {EXECUTED_HEADING[action.type]}
        </p>
        <p className="mt-0.5 text-muted-foreground">{action.entity.displayName}</p>
        <dl className="mt-1.5 space-y-0.5">
          {action.changes.map((change) => (
            <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="sr-only">{change.label}</dt>
              <dd className="font-semibold">
                {change.from ? `${change.from} → ${change.to}` : change.to}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div
      className="rounded-panel border border-border bg-card px-4 py-3 text-[13px] shadow-card dark:shadow-none"
      // Announced when it appears: a proposal arriving unprompted below a
      // reply is exactly the kind of thing a screen reader should mention.
      role="group"
      aria-label="Suggested change awaiting your confirmation"
      aria-busy={busy !== null}
    >
      <div className="flex items-start gap-2">
        <Sparkles aria-hidden className="mt-0.5 size-4 flex-none text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{action.summary}</p>
          <p className="mt-0.5 text-muted-foreground">
            Prepared by the assistant. Nothing changes until you confirm it.
          </p>
        </div>
      </div>

      {/* The diff. Spelled out on both sides so consent is informed. */}
      <dl className="mt-3 space-y-1.5">
        {action.changes.map((change) => (
          <div key={change.field} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">{change.label}</dt>
            <dd className="flex items-center gap-2">
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                {change.from ?? "No follow-up scheduled"}
              </span>
              <ArrowRight aria-hidden className="size-3 flex-none text-muted-foreground" />
              <span className="font-semibold">{change.to}</span>
            </dd>
          </div>
        ))}
      </dl>

      {action.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {action.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-muted-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 flex-none" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* A confirmed action returned above, so the only settled state that
            reaches here is a declined one. */}
        {done ? (
          <p className="flex items-center gap-1.5 font-semibold" role="status">
            <X aria-hidden className="size-4" />
            Declined. Nothing was changed.
          </p>
        ) : expired ? (
          // Stating it rather than hiding the card: a proposal that quietly
          // vanished would leave someone unsure whether it went through.
          <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
            <Clock aria-hidden className="size-3.5" />
            This suggestion expired. Nothing was changed — ask again to prepare a new one.
          </p>
        ) : (
          <>
            <Button size="sm" onClick={() => void run("confirmed")} disabled={busy !== null}>
              {busy === "confirm" ? "Confirming…" : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run("declined")}
              disabled={busy !== null}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
