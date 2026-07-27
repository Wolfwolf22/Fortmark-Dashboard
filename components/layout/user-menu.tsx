"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useQuery } from "@/lib/data/hooks";
import { getCurrentUser } from "@/lib/data/adapters/settings";
import { signOut } from "@/lib/auth/session";
import { cn, initials } from "@/lib/utils";

export function UserMenu({ expanded }: { expanded: boolean }) {
  const router = useRouter();
  const { data: user } = useQuery(() => getCurrentUser(), []);

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
          <AvatarFallback>{user ? initials(user.name) : "·"}</AvatarFallback>
        </Avatar>
        {expanded && (
          <span className="min-w-0 text-left">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {user?.name ?? "…"}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {user?.role ?? ""}
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
          <TooltipContent side="right">{user?.name ?? "Account"}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block text-sm font-bold text-foreground">{user?.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {user?.email}
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
          onSelect={async () => {
            await signOut(); // stub — clears nothing yet
            router.push("/login");
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
