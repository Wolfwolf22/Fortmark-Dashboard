"use client";

/**
 * The compact identity control in the top bar.
 *
 * Everything it renders comes from `ProfileDisplay` — the narrow projection
 * built on the server (`lib/profile/display.ts`). No raw profile row, no Clerk
 * id and no contact detail is in scope here; the drawer fetches the rest on
 * demand from a protected route.
 *
 * Responsive behaviour, narrowest first:
 *   < sm   avatar only
 *   sm     avatar + name
 *   lg     avatar + name + role · licence
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileDrawer } from "@/components/profile/profile-drawer";
import type { ProfileDisplay } from "@/lib/profile/display";
import { cn, initials } from "@/lib/utils";

export function ProfileIdentity({
  display,
  editable,
}: {
  display: ProfileDisplay;
  editable: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const avatar = (
    // 44px, rising to 48px from md — inside the 44–52px band, and at or above
    // the 44px minimum touch target on the sizes where it is the whole control.
    <Avatar className="h-11 w-11 shrink-0 md:h-12 md:w-12">
      {display.imageUrl && <AvatarImage src={display.imageUrl} alt="" />}
      <AvatarFallback>{initials(display.displayName)}</AvatarFallback>
    </Avatar>
  );

  const meta = [display.roleLabel, display.licenseLabel].filter(Boolean).join(" · ");

  const body = (
    <>
      {avatar}
      <span className="hidden min-w-0 text-left sm:block">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
          {display.displayName}
        </span>
        {meta && (
          <span className="hidden truncate text-[11px] leading-tight text-muted-foreground lg:block">
            {meta}
          </span>
        )}
      </span>
    </>
  );

  // Without a persisted record there is nothing for the drawer to show, so the
  // control renders as plain identity rather than a button that opens an empty
  // panel. This is also the shape used whenever the database is unavailable.
  if (!editable) {
    return (
      <div className="flex items-center gap-2.5" data-testid="profile-identity">
        {body}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Your profile — ${display.displayName}`}
        data-testid="profile-identity"
        className={cn(
          "flex max-w-[15rem] items-center gap-2.5 rounded-xl px-1.5 py-1 transition-colors",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        {body}
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:block",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      <ProfileDrawer open={open} onOpenChange={setOpen} display={display} />
    </>
  );
}
