"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useQuery } from "@/lib/data/hooks";
import {
  getNotifications,
  markAllNotificationsRead,
} from "@/lib/data/adapters/notifications";
import { SUBSYSTEM_COPY, unavailableSubsystem } from "@/components/common/subsystem-state";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function NotificationsBell() {
  const { data: notifications, error } = useQuery(() => getNotifications(), []);
  // There is no notification service. The bell stays — it is part of the
  // shell — but it never carries a count it cannot justify, and the panel
  // says why it is empty instead of "nothing needs your attention", which
  // on a zero-data account was a claim nobody had checked.
  const notConnected = unavailableSubsystem(error) !== null;
  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
              {unread > 0 && (
                <span
                  aria-hidden
                  className="absolute right-2 top-2 h-2 w-2 rounded-full bg-foreground ring-2 ring-background"
                />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-bold">Notifications</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => markAllNotificationsRead()}
            disabled={unread === 0}
          >
            Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto py-1">
          {(notifications ?? []).map((n) => (
            <li key={n.id}>
              <Link
                href={n.href}
                className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    n.read ? "bg-border" : "bg-foreground"
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold leading-snug">
                    {n.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {n.detail}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatRelative(n.date)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {notConnected && (
            <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              {SUBSYSTEM_COPY.notifications.title}
            </li>
          )}
          {!notConnected && notifications && notifications.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing needs your attention.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
