"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageThread } from "@/lib/data/types";
import { cn, formatRelative, initials } from "@/lib/utils";
import { PARTICIPANT_ROLE_LABELS, previewOf } from "./message-shared";
import { Inbox } from "lucide-react";

/** Left pane: every conversation, most recent first. */
export function ThreadList({
  threads,
  activeId,
  loading,
  mounted,
  onSelect,
}: {
  threads: MessageThread[] | undefined;
  activeId: string | null;
  loading: boolean;
  /** Relative timestamps wait for mount so SSR and the client agree. */
  mounted: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading && !threads) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-panel" />
        ))}
      </div>
    );
  }

  if (!threads?.length) {
    return (
      <EmptyState
        icon={Inbox}
        title="No conversations"
        description="Clear the search or filter to see the rest of the inbox."
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="space-y-0.5 p-2">
        {threads.map((thread) => {
          const active = thread.id === activeId;
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 rounded-panel px-3 py-2.5 text-left",
                  "transition-colors duration-150",
                  active ? "bg-tint" : "hover:bg-accent"
                )}
              >
                <Avatar className="mt-0.5 h-8 w-8 flex-none">
                  <AvatarFallback>{initials(thread.participantName)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[13px]",
                        thread.unread ? "font-bold" : "font-medium"
                      )}
                    >
                      {thread.participantName}
                    </span>
                    <span className="flex-none text-[11px] text-muted-foreground tabular">
                      {mounted ? formatRelative(thread.lastMessageDate) : " "}
                    </span>
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {PARTICIPANT_ROLE_LABELS[thread.participantRole]} ·{" "}
                    {thread.subject}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {previewOf(thread)}
                  </span>
                </span>
                {thread.unread && (
                  <span
                    className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-primary"
                    aria-label="Unread"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
