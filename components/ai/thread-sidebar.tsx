"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatThread } from "@/lib/ai/types";
import { cn, formatRelative } from "@/lib/utils";

/**
 * Conversation list. Threads are ordered most-recent-first by the page;
 * this component only renders and reports intent.
 */
export function ThreadSidebar({
  threads,
  activeId,
  mounted,
  onSelect,
  onNew,
  onDelete,
}: {
  threads: ChatThread[];
  activeId: string | null;
  /** Timestamps only render after mount — they are relative to "now". */
  mounted: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        variant="outline"
        onClick={onNew}
        className="w-full justify-start gap-2"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New conversation
      </Button>

      {threads.length === 0 ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          No conversations yet. Ask a question to start one.
        </p>
      ) : (
        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <ul className="space-y-0.5 px-1">
            {threads.map((thread) => {
              const active = thread.id === activeId;
              return (
                <li key={thread.id} className="group/thread relative">
                  <button
                    type="button"
                    onClick={() => onSelect(thread.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "w-full rounded-panel px-3 py-2 pr-9 text-left transition-colors duration-150",
                      active ? "bg-tint" : "hover:bg-accent"
                    )}
                  >
                    <span className="block truncate text-[13px] font-medium">
                      {thread.title}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {mounted ? formatRelative(thread.updatedAt) : " "}
                    </span>
                  </button>
                  <Button
                    variant="muted"
                    size="icon-sm"
                    aria-label={`Delete ${thread.title}`}
                    onClick={() => onDelete(thread.id)}
                    className={cn(
                      "absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0",
                      "transition-opacity duration-150",
                      "focus-visible:opacity-100 group-hover/thread:opacity-100"
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
