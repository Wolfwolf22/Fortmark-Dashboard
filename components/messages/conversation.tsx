"use client";

import * as React from "react";
import { SendHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MessageThread } from "@/lib/data/types";
import { cn, formatDate, formatTime, initials } from "@/lib/utils";
import { PARTICIPANT_ROLE_LABELS } from "./message-shared";

/** Right pane: the open conversation and its reply box. */
export function Conversation({
  thread,
  loading,
  mounted,
  sending,
  onSend,
}: {
  thread: MessageThread | undefined;
  loading: boolean;
  mounted: boolean;
  sending: boolean;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  // Reset the draft when the conversation changes — drafts are per-thread.
  React.useEffect(() => setDraft(""), [thread?.id]);

  // Keep the newest message in view.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.id, thread?.messages.length]);

  if (loading && !thread) {
    return (
      <div className="flex h-full flex-col gap-4 p-5">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-full w-full rounded-panel" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-[13px] text-muted-foreground">
          Select a conversation to read it.
        </p>
      </div>
    );
  }

  function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    onSend(body);
    setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none items-center gap-3 px-5 py-4">
        <Avatar className="h-9 w-9">
          <AvatarFallback>{initials(thread.participantName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {thread.participantName}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {thread.subject}
          </p>
        </div>
        <Badge variant="secondary">
          {PARTICIPANT_ROLE_LABELS[thread.participantRole]}
        </Badge>
      </header>
      <Separator />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ul className="space-y-3">
          {thread.messages.map((message, i) => {
            const mine = message.from === "me";
            const prev = thread.messages[i - 1];
            // Date separator whenever the calendar day changes.
            const showDay =
              !prev ||
              new Date(prev.date).toDateString() !==
                new Date(message.date).toDateString();
            return (
              <React.Fragment key={message.id}>
                {showDay && (
                  <li className="pt-2 text-center">
                    <span className="text-micro">{formatDate(message.date)}</span>
                  </li>
                )}
                <li className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className="max-w-[75%]">
                    <div
                      className={cn(
                        "whitespace-pre-wrap rounded-panel px-3.5 py-2.5 text-[13px] leading-relaxed",
                        mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-tint text-foreground"
                      )}
                    >
                      {message.body}
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-[11px] text-muted-foreground tabular",
                        mine ? "text-right" : "text-left"
                      )}
                    >
                      {mounted ? formatTime(message.date) : " "}
                    </p>
                  </div>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="flex-none px-5 pb-5">
        <div className="flex items-end gap-2 rounded-panel border border-input bg-card p-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={`Reply to ${thread.participantName}`}
            aria-label="Reply"
            className="min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 focus-visible:outline-none"
          />
          <Button
            size="icon"
            onClick={submit}
            disabled={!draft.trim() || sending}
            aria-label="Send reply"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
