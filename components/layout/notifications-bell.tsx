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
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function NotificationsBell({ expanded }: { expanded: boolean }) {
  const { data: notifications } = useQuery(() => getNotifications(), []);
  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className={cn(
          "relative flex items-center gap-3 rounded-xl text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          expanded ? "w-full px-3 py-2.5" : "h-10 w-10 justify-center"
        )}
      >
        <span className="relative">
          <Bell className="h-[18px] w-[18px]" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-foreground ring-2 ring-card"
            />
          )}
        </span>
        {expanded && <span>Notifications</span>}
        {expanded && unread > 0 && (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover>
      {expanded ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Notifications</TooltipContent>
        </Tooltip>
      )}
      <PopoverContent side="right" align="end" className="w-80 p-0">
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
          {notifications && notifications.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing needs your attention.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
