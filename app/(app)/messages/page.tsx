"use client";

/**
 * Messages — two-pane inbox. The thread list filters by search, role, and
 * unread; opening a thread marks it read. Replies go through the messages
 * adapter, which bumps the data version and refetches both panes.
 */
import * as React from "react";
import { Search } from "lucide-react";
import { Conversation } from "@/components/messages/conversation";
import { ThreadList } from "@/components/messages/thread-list";
import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
} from "@/components/messages/message-shared";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import {
  getThreads,
  markThreadRead,
  sendThreadMessage,
} from "@/lib/data/adapters/messages";
import { useQuery } from "@/lib/data/hooks";
import { MessageThread } from "@/lib/data/types";

type RoleFilter = "all" | MessageThread["participantRole"];
type ReadFilter = "all" | "unread";

export default function Page() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [role, setRole] = React.useState<RoleFilter>("all");
  const [read, setRead] = React.useState<ReadFilter>("all");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  const { data: threads, loading } = useQuery(() => getThreads(), []);

  const visible = React.useMemo(() => {
    if (!threads) return undefined;
    const q = debouncedSearch.trim().toLowerCase();
    return threads.filter((t) => {
      if (role !== "all" && t.participantRole !== role) return false;
      if (read === "unread" && !t.unread) return false;
      if (!q) return true;
      return (
        t.participantName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.messages.some((m) => m.body.toLowerCase().includes(q))
      );
    });
  }, [threads, debouncedSearch, role, read]);

  // Open the first visible thread once, and follow the filters if the open
  // thread drops out of view.
  React.useEffect(() => {
    if (!visible) return;
    if (activeId && visible.some((t) => t.id === activeId)) return;
    setActiveId(visible[0]?.id ?? null);
  }, [visible, activeId]);

  // Opening a thread clears its unread mark.
  React.useEffect(() => {
    if (activeId) void markThreadRead(activeId);
  }, [activeId]);

  const active = threads?.find((t) => t.id === activeId);

  async function handleSend(body: string) {
    if (!activeId) return;
    setSending(true);
    try {
      await sendThreadMessage(activeId, body);
    } finally {
      setSending(false);
    }
  }

  const unreadCount = threads?.filter((t) => t.unread).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people, subjects, or message text"
            aria-label="Search messages"
            className="pl-9"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as RoleFilter)}>
          <SelectTrigger aria-label="Filter by role" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {PARTICIPANT_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {PARTICIPANT_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented<ReadFilter>
          ariaLabel="Filter by read state"
          options={[
            { value: "all", label: "All" },
            {
              value: "unread",
              label: mounted && unreadCount ? `Unread (${unreadCount})` : "Unread",
            },
          ]}
          value={read}
          onChange={setRead}
        />
      </div>

      <Card className="flex min-h-0 flex-1 overflow-hidden p-0">
        <div className="w-full max-w-[22rem] flex-none border-r border-border md:w-[22rem]">
          <ThreadList
            threads={visible}
            activeId={activeId}
            loading={loading}
            mounted={mounted}
            onSelect={setActiveId}
          />
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <Conversation
            thread={active}
            loading={loading}
            mounted={mounted}
            sending={sending}
            onSend={handleSend}
          />
        </div>
      </Card>
    </div>
  );
}
