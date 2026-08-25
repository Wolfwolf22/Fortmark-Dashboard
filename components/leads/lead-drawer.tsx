"use client";

/**
 * Lead detail drawer — full record, notes, a stage select that advances the
 * lead through the pipeline, and a quiet "Mark contacted today" action.
 * Mutations go through the adapter, which bumps the data version so every
 * open list refetches on its own.
 */
import { useState, type ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { getAgent } from "@/lib/data/adapters/agents";
import { getLead, updateLeadStage } from "@/lib/data/adapters/leads";
import { canWrite, writeDisabledReason } from "@/lib/data/provenance";
import { useQuery } from "@/lib/data/hooks";
import {
  Lead,
  LeadStage,
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
} from "@/lib/data/types";
import { cn, formatCurrency, formatDate, formatRelative, initials } from "@/lib/utils";
import { INTENT_LABELS, needsFollowUp } from "./lead-shared";

export interface LeadDrawerProps {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Fact({
  label,
  value,
  numeric,
}: {
  label: string;
  value: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div>
      <p className="text-micro">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", numeric && "tabular")}>
        {value}
      </p>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">Loading lead</SheetTitle>
        <SheetDescription className="sr-only">
          Lead details are loading
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-40 w-full rounded-panel" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </>
  );
}

export function LeadDrawer({ leadId, open, onOpenChange }: LeadDrawerProps) {
  const { data, loading } = useQuery<Lead | undefined>(
    () => (leadId ? getLead(leadId) : Promise.resolve(undefined)),
    [leadId]
  );
  // Guard against stale data from a previously opened lead.
  const lead = data && data.id === leadId ? data : undefined;

  const agentId = lead?.assignedAgentId ?? null;
  const { data: agent } = useQuery(
    () => (agentId ? getAgent(agentId) : Promise.resolve(undefined)),
    [agentId]
  );

  const [saving, setSaving] = useState(false);

  async function changeStage(stage: LeadStage) {
    if (!lead || saving) return;
    setSaving(true);
    try {
      // The adapter bumps the data version, so the drawer, the table, and
      // the summary strip all refetch on their own.
      // A sample-backed domain accepts this write into an in-memory
      // fixture and loses it on reload. Refuse it rather than let the
      // change look saved.
      if (!canWrite("leads")) return;
      await updateLeadStage(lead.id, stage);
    } finally {
      setSaving(false);
    }
  }

  const overdue = lead ? needsFollowUp(lead.lastContactDate) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto p-6 sm:max-w-xl">
        {lead ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle>{lead.name}</SheetTitle>
              <SheetDescription>
                {lead.email} · {lead.phone}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{LEAD_SOURCE_LABELS[lead.source]}</Badge>
              <Badge variant="secondary">{LEAD_STAGE_LABELS[lead.stage]}</Badge>
              {overdue && <StatusPill tone="warn">Follow up</StatusPill>}
            </div>
            <div className="flex-1">
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 rounded-panel bg-tint p-4">
                <Fact label="Intent" value={INTENT_LABELS[lead.intent]} />
                <Fact
                  label="Budget"
                  numeric
                  value={lead.budget != null ? formatCurrency(lead.budget) : "—"}
                />
                <Fact label="Neighborhood" value={lead.neighborhood ?? "—"} />
                <Fact
                  label="Assigned agent"
                  value={
                    agent ? (
                      <span className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {initials(agent.name)}
                          </AvatarFallback>
                        </Avatar>
                        {agent.name}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Fact label="Created" numeric value={formatDate(lead.createdDate)} />
                <Fact
                  label="Last contact"
                  numeric
                  value={formatRelative(lead.lastContactDate)}
                />
              </div>
              <div className="mt-6">
                <p className="text-micro">Stage</p>
                <Select
                  value={lead.stage}
                  onValueChange={(v) => changeStage(v as LeadStage)}
                  disabled={saving || !canWrite("leads")}
                >
                  <SelectTrigger
                    aria-label="Lead stage"
                    className="mt-2 w-full sm:w-56"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {LEAD_STAGE_LABELS[stage]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canWrite("leads") && (
                  <p role="note" className="mt-2 text-[12px] text-muted-foreground">
                    {writeDisabledReason("leads")}
                  </p>
                )}
              </div>
              <p className="text-micro mt-6">Notes</p>
              <p
                className={cn(
                  "mt-2 text-sm leading-6",
                  lead.notes ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {lead.notes || "No notes yet."}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={() => changeStage(lead.stage)}
                disabled={saving}
              >
                Mark contacted today
              </Button>
              <p className="text-xs text-muted-foreground">
                Sets last contact to now.
              </p>
            </div>
          </>
        ) : loading && leadId ? (
          <DrawerSkeleton />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Lead</SheetTitle>
              <SheetDescription className="sr-only">Lead details</SheetDescription>
            </SheetHeader>
            <p className="mt-8 text-sm text-muted-foreground">
              This lead is no longer available.
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
