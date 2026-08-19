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
import type { ProfileDetail, ProfileDisplay } from "@/lib/profile/display";
import { apiPath } from "@/lib/routes";
import { initials } from "@/lib/utils";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; profile: ProfileDetail | null; imageUploadEnabled: boolean }
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

  React.useEffect(() => {
    if (!open || state.status !== "idle") return;

    const controller = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch(apiPath("/api/profile"), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          profile: ProfileDetail | null;
          imageUploadEnabled?: boolean;
        };
        setState({
          status: "ready",
          profile: body.profile ?? null,
          // Absent means "an older server that did not report it" — assume
          // enabled and let the upload route's 404 be the answer, which is
          // exactly the pre-existing behaviour.
          imageUploadEnabled: body.imageUploadEnabled !== false,
        });
      } catch (error) {
        // An aborted fetch is the drawer closing, not a failure.
        if ((error as Error)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();

    return () => controller.abort();
  }, [open, state.status]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // 400–460px on desktop; full-bleed below sm where a fixed panel would
        // overflow. `sm:max-w-sm` from the primitive is overridden explicitly.
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
                onSaved={(profile) =>
                  setState({
                    status: "ready",
                    profile,
                    imageUploadEnabled: state.imageUploadEnabled,
                  })
                }
              />
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
