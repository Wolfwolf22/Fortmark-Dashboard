"use client";

/**
 * Right-side profile drawer.
 *
 * Accessibility is delegated to Radix Dialog rather than reimplemented: it
 * provides the focus trap, Escape-to-close, `aria-modal`, the labelled title,
 * inert background content, and focus restoration to the trigger on close.
 * The tests assert the resulting DOM contract, not the implementation.
 *
 * Detail is fetched only when the drawer first opens, from the protected
 * `/api/profile` route. That keeps every field beyond the compact projection
 * out of the global client context — a page that never opens the drawer never
 * ships the caller's phone number, licence number or NRDS id.
 */
import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { DigitalBusinessCard } from "@/components/profile/digital-business-card";
import { SignOutLink } from "@/components/layout/sign-out-link";
import { Button } from "@/components/ui/button";
import { IdCard, LogOut } from "lucide-react";
import type { ProfileDetail, ProfileDisplay } from "@/lib/profile/display";
import type { HomeIdentityCard } from "@/lib/profile/home-card";
import { apiPath } from "@/lib/routes";
import { initials } from "@/lib/utils";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      profile: ProfileDetail | null;
      imageUploadEnabled: boolean;
      card: HomeIdentityCard | null;
    }
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
  const [cardOpen, setCardOpen] = React.useState(false);
  /**
   * The drawer opens on a READ-ONLY summary.
   *
   * Clicking your own avatar is a "who am I here" question, not "let me fill
   * in a form". Opening straight onto the editor made a finished profile look
   * like onboarding all over again — every field sitting empty-ish in an input
   * box reads as a task list, not as a record.
   */
  const [mode, setMode] = React.useState<"card" | "edit">("card");

  // A fresh open always starts on the summary, even if the last visit ended
  // mid-edit; otherwise the drawer silently remembers a mode the user did not
  // choose this time.
  React.useEffect(() => {
    if (open) setMode("card");
  }, [open]);

  /**
   * Load the profile whenever the drawer opens.
   *
   * `open` is the ONLY dependency, and that is the fix for a drawer that could
   * never finish loading. The effect previously also depended on
   * `state.status` while calling `setState({ status: "loading" })` inside
   * itself: the state change re-ran the effect, React fired the previous
   * cleanup, the cleanup aborted the in-flight request, the catch swallowed
   * the AbortError as "the drawer closed", and the re-run bailed out because
   * the status was no longer "idle". Every open aborted its own fetch and sat
   * on "Loading your profile…" forever.
   *
   * A local `cancelled` flag now distinguishes "this effect was torn down"
   * from "the request failed", so a genuine failure still surfaces as an
   * error rather than a permanent spinner.
   */
  React.useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    let cancelled = false;

    // Keep whatever is already loaded on screen while refreshing, so
    // reopening the drawer does not flash a spinner over good data.
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
          imageUploadEnabled?: boolean;
        };
        if (cancelled) return;
        setState({
          status: "ready",
          profile: body.profile ?? null,
          card: body.card ?? null,
          // Absent means "an older server that did not report it" — assume
          // enabled and let the upload route's 404 be the answer, which is
          // exactly the pre-existing behaviour.
          imageUploadEnabled: body.imageUploadEnabled !== false,
        });
      } catch (error) {
        // Torn down, not failed — the drawer closed or the effect re-ran.
        if (cancelled || (error as Error)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open]);

  const ready = state.status === "ready";
  const card = ready ? state.card : null;

  // The card is the default surface, but it needs data. Until that arrives —
  // or if it never does — the sheet below carries the loading and error
  // states, and the editor, which works from `profile` alone.
  const showCard = ready && card !== null && mode === "card";

  return (
    <>
      {card && (
        <DigitalBusinessCard
          data={card}
          open={open && showCard}
          onOpenChange={(next) => {
            if (!next) onOpenChange(false);
          }}
          onEdit={() => setMode("edit")}
          showSignOut
        />
      )}

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

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-5">
              {state.status === "loading" || state.status === "idle" ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading your profile…
                </p>
              ) : state.status === "error" ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Your profile could not be loaded right now. Everything else in the
                  dashboard is unaffected — try again in a moment.
                </p>
              ) : (
                <ProfileEditor
                  initial={state.profile}
                  imageUploadEnabled={state.imageUploadEnabled}
                  onSaved={(profile) => {
                    setState({
                      status: "ready",
                      profile,
                      imageUploadEnabled: state.imageUploadEnabled,
                      card: state.card,
                    });
                    // Back to the card once saved, so editing ends on the
                    // record rather than leaving a form open.
                    setMode("card");
                  }}
                />
              )}
            </div>
          </ScrollArea>

          {/* Only shown while editing or degraded. The card carries its own
              actions, including sign out, when it is the visible surface. */}
          <div className="flex shrink-0 items-center gap-2 border-t border-border p-5">
            {ready && card && (
              <Button
                variant="outline"
                className="h-10 min-w-0 flex-1 border-foreground/45 px-3 text-[13px]"
                onClick={() => setMode("card")}
              >
                <IdCard aria-hidden />
                <span className="truncate">Digital card</span>
              </Button>
            )}
            <SignOutLink className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-foreground/45 px-3 text-[13px] font-semibold transition-colors hover:bg-accent">
              <LogOut aria-hidden className="size-4 shrink-0" />
              <span className="truncate">Sign out</span>
            </SignOutLink>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
