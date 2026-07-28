"use client";

import Link from "next/link";
import { ArrowUpRight, MapPin, StickyNote, User } from "lucide-react";
import { EVENT_TYPE_ICONS } from "./event-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgent } from "@/lib/data/adapters/agents";
import { useQuery } from "@/lib/data/hooks";
import { CalendarEvent, EVENT_TYPE_LABELS } from "@/lib/data/types";
import { formatDate, formatTime } from "@/lib/utils";

/** Event detail dialog: type, when, where, who, notes, transaction link. */
export function EventDetail({
  event,
  open,
  onOpenChange,
}: {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agentId = event?.agentId ?? null;
  const { data: agent, loading: agentLoading } = useQuery(
    () => (agentId ? getAgent(agentId) : Promise.resolve(undefined)),
    [agentId]
  );

  const Icon = event ? EVENT_TYPE_ICONS[event.type] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {event && Icon && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tint">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-micro">{EVENT_TYPE_LABELS[event.type]}</span>
              </div>
              <DialogTitle className="pt-1">{event.title}</DialogTitle>
              <DialogDescription className="tabular">
                {formatDate(event.start)} · {formatTime(event.start)} –{" "}
                {formatTime(event.end)}
              </DialogDescription>
            </DialogHeader>

            <Separator />

            <div className="space-y-3 text-sm">
              {event.address && (
                <div className="flex items-start gap-2.5">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div>
                    <p className="text-micro mb-0.5">Address</p>
                    <p>{event.address}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2.5">
                <User
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div>
                  <p className="text-micro mb-0.5">Agent</p>
                  {agentLoading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : agent ? (
                    <p>
                      {agent.name}
                      <span className="text-muted-foreground"> · {agent.phone}</span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Unassigned</p>
                  )}
                </div>
              </div>
              {event.notes && (
                <div className="flex items-start gap-2.5">
                  <StickyNote
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div>
                    <p className="text-micro mb-0.5">Notes</p>
                    <p className="text-muted-foreground">{event.notes}</p>
                  </div>
                </div>
              )}
            </div>

            {event.transactionId && (
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/transactions?open=${event.transactionId}`}>
                    Open transaction
                    <ArrowUpRight aria-hidden />
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
