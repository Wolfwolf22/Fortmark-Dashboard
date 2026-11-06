"use client";

/**
 * Entering a represented stage requires a current private PDF plus explicit
 * acknowledgement. The software does not verify the agreement's contents.
 * Cancel leaves the stage unchanged.
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONTACT_STAGE_LABELS, type ContactStage } from "@/lib/contacts/stages";
import{useEffect,useState,type ReactNode}from"react";
import{Checkbox}from"@/components/ui/checkbox";
import{ENGAGEMENT_WARNING}from"@/lib/contacts/engagement";

/** An acknowledgement belongs to the exact stage and PDF revision reviewed. */
export const engagementAcknowledgementKey=(target:ContactStage|null,revision?:string)=>JSON.stringify([target,revision??null]);

export function EngagementNotice({
  target,
  busy,
  onCancel,
  onContinue,
  returnFocusTo,
  engagementReady=false,
  engagementRevision,
  children,
  skipReturnFocus=false,
}: {
  /** The stage being entered, or null when the notice is closed. */
  target: ContactStage | null;
  busy: boolean;
  onCancel: () => void;
  onContinue: () => void;
  /**
   * The id of the control to hand focus back to. The notice opens from a select's
   * `onValueChange` while the select's own popup is still closing, so there is no
   * stable "element that had focus" to return to — the caller names it.
   */
  returnFocusTo?: string;
  engagementReady?:boolean;
  engagementRevision?:string;
  children?:ReactNode;
  skipReturnFocus?:boolean;
}) {
  const[acknowledgedFor,setAcknowledgedFor]=useState<string|null>(null),proofKey=engagementAcknowledgementKey(target,engagementRevision),acknowledged=engagementReady&&acknowledgedFor===proofKey;useEffect(()=>setAcknowledgedFor(null),[target,engagementReady,engagementRevision]);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if(skipReturnFocus){event.preventDefault();return;}
          const el = returnFocusTo ? document.getElementById(returnFocusTo) : null;
          if (!el) return;
          event.preventDefault();
          el.focus();
        }}
      >
        <div className="max-h-[85dvh] overflow-y-auto pr-1"><DialogHeader>
          <DialogTitle>Brokerage engagement</DialogTitle>
          <DialogDescription>
            Before marking this contact as {target ? (target === "active_client" ? "an " : "in ") : ""}
            <strong>{target ? CONTACT_STAGE_LABELS[target] : ""}</strong>, confirm that an active brokerage engagement is in
            place. An executed engagement should be attached to the contact record.
          </DialogDescription>
        </DialogHeader>
        {children}
        <p className="mt-3 text-[13px] text-muted-foreground">{ENGAGEMENT_WARNING}</p>
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-panel border border-border p-3 text-sm"><Checkbox checked={acknowledged} disabled={busy||!engagementReady} onCheckedChange={value=>setAcknowledgedFor(value===true?proofKey:null)}/><span>I confirm that the current engagement PDF is attached and I have reviewed and understood it.</span></label>
        {!engagementReady&&<p role="note" className="mt-2 text-xs text-muted-foreground">Attach a current PDF before continuing.</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onContinue} disabled={busy||!engagementReady||!acknowledged}>
            {busy ? "Saving…" : "Confirm and start transaction"}
          </Button>
        </DialogFooter></div>
      </DialogContent>
    </Dialog>
  );
}
