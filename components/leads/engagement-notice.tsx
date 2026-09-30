"use client";

/**
 * The brokerage-engagement notice, shown when a contact is moved INTO Active
 * client or Representation.
 *
 * It is an acknowledgement and nothing more. Nothing here checks for, verifies
 * or attaches an agreement, and it does not say whether one would be legally
 * sufficient — secure document storage does not exist yet, so the notice asks the
 * person to confirm the fact themselves and records that they did. Cancel leaves
 * the stage exactly as it was.
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONTACT_STAGE_LABELS, type ContactStage } from "@/lib/contacts/stages";

export function EngagementNotice({
  target,
  busy,
  onCancel,
  onContinue,
}: {
  /** The stage being entered, or null when the notice is closed. */
  target: ContactStage | null;
  busy: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Brokerage engagement</DialogTitle>
          <DialogDescription>
            Before marking this contact as {target ? (target === "active_client" ? "an " : "in ") : ""}
            <strong>{target ? CONTACT_STAGE_LABELS[target] : ""}</strong>, confirm that an active brokerage engagement is in
            place. An executed engagement should be attached to the contact record.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">FortMark does not yet store or check engagement documents. Continuing records that you confirmed this.</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onContinue} disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
