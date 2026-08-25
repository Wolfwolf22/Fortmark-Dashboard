"use client";

/**
 * The account surface behind the top-bar identity.
 *
 * Opening your own avatar asks "who am I here", and the digital card already
 * answers it — it is the finished, shareable presentation of the profile. So
 * this renders the card, plus sign out.
 *
 * It deliberately does NOT edit. Every "Edit profile" in the app routes to
 * /settings?tab=profile, so there is one editor, one set of validation
 * messages, and one place a field can be added. An embedded second copy of the
 * form is how two surfaces start disagreeing about what a field is called.
 *
 * Detail is fetched only when the drawer first opens, from the protected
 * `/api/profile` route, so a page that never opens it never ships the caller's
 * phone number, licence number or NRDS id.
 */
import * as React from "react";
import { LogOut } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DigitalBusinessCard } from "@/components/profile/digital-business-card";
import { SignOutLink } from "@/components/layout/sign-out-link";
import type { ProfileDetail, ProfileDisplay } from "@/lib/profile/display";
import type { HomeIdentityCard } from "@/lib/profile/home-card";
import { apiPath } from "@/lib/routes";
import { initials } from "@/lib/utils";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; card: HomeIdentityCard | null }
  | { status: "error" };

export function ProfileDrawer({
  open,
  onOpenChange,
  display,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  display: ProfileDisplay;
}) {
  const [state, setState] = React.useState<LoadState>({ status: "idle" });

  /**
   * Load whenever the drawer opens.
   *
   * `open` is the ONLY dependency, and that matters: this effect previously
   * also depended on `state.status` while setting that status inside itself.
   * The state change re-ran the effect, React fired the previous cleanup, the
   * cleanup aborted the in-flight request, and the catch swallowed the
   * AbortError as "the drawer closed" — so every open aborted its own fetch
   * and sat on "Loading…" forever.
   */
  React.useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    void (async () => {
      try {
        const response = await fetch(apiPath("/api/profile"), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          profile: ProfileDetail | null;
          card?: HomeIdentityCard | null;
        };
        if (cancelled) return;
        setState({ status: "ready", card: body.card ?? null });
      } catch (error) {
        // Torn down, not failed.
        if (cancelled || (error as Error)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open]);

  const card = state.status === "ready" ? state.card : null;
  const showCard = card !== null;

  return (
    <>
      {card && (
        <DigitalBusinessCard
          data={card}
          open={open && showCard}
          onOpenChange={(next) => {
            if (!next) onOpenChange(false);
          }}
          showSignOut
        />
      )}

      {/* Only while loading, failing, or when no card could be built. The card
          carries its own actions once it is the visible surface. */}
      <Sheet
        open={open && !showCard}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-none sm:w-[400px] lg:w-[440px] xl:w-[460px]"
          aria-label="Your professional profile"
        >
          <SheetHeader className="flex-row items-center gap-3 border-b border-border p-5 pr-12">
            <Avatar className="h-12 w-12 shrink-0">
              {display.imageUrl && <AvatarImage src={display.imageUrl} alt="" />}
              <AvatarFallback>{initials(display.displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{display.displayName}</SheetTitle>
              <SheetDescription className="truncate">
                {[display.roleLabel, display.licenseLabel].filter(Boolean).join(" · ")}
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 p-5">
            {state.status === "error" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Your profile could not be loaded right now. Everything else in the
                dashboard is unaffected — try again in a moment.
              </p>
            ) : state.status === "ready" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Your professional profile has not been set up yet.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                Loading your profile…
              </p>
            )}
          </div>

          {/* Sign out has to live here too: this sheet is what shows when the
              card cannot be built, and the rail's account menu is gone. */}
          <div className="shrink-0 border-t border-border p-5">
            <SignOutLink className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-foreground/45 px-3 text-[13px] font-semibold transition-colors hover:bg-accent">
              <LogOut aria-hidden className="size-4 shrink-0" />
              <span className="truncate">Sign out</span>
            </SignOutLink>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
