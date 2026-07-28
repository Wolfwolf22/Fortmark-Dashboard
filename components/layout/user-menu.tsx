"use client";

import Link from "next/link";
import { LogOut, User, Users } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionUser } from "@/components/layout/session-user";
import { ROUTES, portalUrl } from "@/lib/routes";
import { cn, initials } from "@/lib/utils";

/**
 * The FortMark account control. Identity comes from the server-resolved Clerk
 * session (see `components/layout/session-user.tsx`), so there is no loading
 * flash and no client fetch — the custom dropdown design is unchanged.
 */
export function UserMenu({ expanded }: { expanded: boolean }) {
  const user = useSessionUser();
  const { signOut } = useClerk();

  const avatar = (
    <Avatar className="h-7 w-7">
      {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );

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
        {avatar}
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
          <span className="block text-sm font-bold text-foreground">
            {user.name}
          </span>
          {user.email && (
            <span className="block text-xs font-normal text-muted-foreground">
              {user.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={ROUTES.settings}>
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${ROUTES.settings}?tab=team`}>
            <Users />
            Team
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // Clerk clears the session cookie, then returns to the public
            // portal — an absolute origin we control, never user input.
            void signOut({ redirectUrl: portalUrl() });
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
