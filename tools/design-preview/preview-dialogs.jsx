import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useUiStore } from "@/lib/stores/ui";
import { QuickCreateDialog as ActualQuickCreateDialog } from "../../components/layout/quick-create-dialog";
import { interactiveSamples } from "./sample-session.mjs";

export function ProfileDrawer({ open, onOpenChange, display }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{display.displayName}</DialogTitle><DialogDescription>Design preview profile</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">This is a synthetic identity for reviewing the navigation and design. No account is connected.</p></DialogContent></Dialog>;
}
export function QuickCreateDialog() {
  const kind = useUiStore(s => s.quickCreate);
  const setKind = useUiStore(s => s.setQuickCreate);
  const interactive = interactiveSamples();
  // Keep recovery state mounted across every New menu selection. The real
  // dialog only accepts transactions; other kinds use the read-only preview.
  return <>
    {interactive && <ActualQuickCreateDialog allowedKinds={["transaction", "event"]} />}
    <Dialog open={!!kind && (!interactive || !["transaction", "event"].includes(kind))} onOpenChange={open => !open && setKind(null)}><DialogContent><DialogHeader><DialogTitle>Design preview</DialogTitle><DialogDescription>Creation is disabled in this visual review.</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">The real navigation and shared controls are shown here. No live records or services are connected.</p></DialogContent></Dialog>
  </>;
}
