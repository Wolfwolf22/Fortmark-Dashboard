"use client";

import Link from "next/link";
import { LogOut, User, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClerk } from "@clerk/nextjs";
import { useSession } from "@/lib/auth/session-context";
import { CANONICAL_DASHBOARD_URL } from "@/lib/auth/config";
import { cn, initials } from "@/lib/utils";

export function UserMenu({ expanded }: { expanded: boolean }) {
  // The REAL authenticated identity, handed down by the protected server
  // layout. Previously this read a mock "Marcus Webb" record.
  const { user } = useSession();
  const { signOut } = useClerk();

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Account menu"
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          expanded ? "w-full px-3 py-2" : "h-10 w-10 justify-center"
        )}
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        {expanded && (
          <span className="min-w-0 text-left">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {user.name}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {user.role}
            </span>
          </span>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {expanded ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{user.name}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block text-sm font-bold text-foreground">{user.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=team">
            <Users />
            Team
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // Real Clerk sign-out: revokes the session and clears its cookies,
            // then lands on the canonical dashboard URL, which the middleware
            // bounces to the sign-in page. `redirectUrl` is absolute so the
            // user always returns to app.fortmark.net, never a raw
            // deployment URL.
            void signOut({ redirectUrl: CANONICAL_DASHBOARD_URL });
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
