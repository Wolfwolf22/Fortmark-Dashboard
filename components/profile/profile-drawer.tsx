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
import { IdCard, LogOut, Pencil } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/profile/links";
import { mlsBoardLabel, mlsStatusLabel } from "@/lib/profile/mls";
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
  const [mode, setMode] = React.useState<"view" | "edit">("view");

  // A fresh open always starts on the summary, even if the last visit ended
  // mid-edit; otherwise the drawer silently remembers a mode the user did not
  // choose this time.
  React.useEffect(() => {
    if (open) setMode("view");
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
              mode === "view" ? (
                <ProfileSummary
                  card={state.card}
                  profile={state.profile}
                  onEdit={() => setMode("edit")}
                />
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
                    // Back to the record once it is saved, so the drawer ends
                    // where it started rather than leaving a form open.
                    setMode("view");
                  }}
                />
              )
            )}
          </div>
        </ScrollArea>

        {/* Account actions. Sign out lives here because this strip is now the
            only account control — the duplicate menu in the nav rail's bottom
            corner was removed. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border p-5">
          <Button
            variant="outline"
            className="h-10 min-w-0 flex-1 border-foreground/45 px-3 text-[13px]"
            onClick={() => setCardOpen(true)}
            disabled={state.status !== "ready" || !state.card}
          >
            <IdCard aria-hidden />
            <span className="truncate">Digital card</span>
          </Button>
          <SignOutLink className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-foreground/45 px-3 text-[13px] font-semibold transition-colors hover:bg-accent">
            <LogOut aria-hidden className="size-4 shrink-0" />
            <span className="truncate">Sign out</span>
          </SignOutLink>
        </div>
      </SheetContent>

      {/* Rendered outside SheetContent so the card is not nested inside the
          drawer's focus trap — two stacked traps fight over focus. */}
      {state.status === "ready" && state.card && (
        <DigitalBusinessCard
          data={state.card}
          open={cardOpen}
          onOpenChange={setCardOpen}
        />
      )}
    </Sheet>
  );
}

/** One labelled read-only value. Renders nothing when there is nothing to say. */
function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/55">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[13px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The read-only record.
 *
 * Built from the same `HomeIdentityCard` projection the Home card and the
 * Digital Card use, so the title label and the published email shown here
 * cannot disagree with what those surfaces show. MLS comes off the detail
 * projection, which is the only one carrying it.
 *
 * Empty fields are omitted rather than rendered as "Not added" rows: this is a
 * record of what someone HAS, and a column of blanks is what made the editor
 * feel like an unfinished form.
 */
function ProfileSummary({
  card,
  profile,
  onEdit,
}: {
  card: HomeIdentityCard | null;
  profile: ProfileDetail | null;
  onEdit: () => void;
}) {
  const completion = card?.completion ?? profile?.completion ?? null;
  const licence = [profile?.licenseState, profile?.licenseNumber]
    .filter(Boolean)
    .join(" ") || null;
  const mlsId = profile?.mlsAgentId ?? null;
  const board = mlsBoardLabel(profile?.mlsOrganization);

  return (
    <div className="space-y-5">
      {typeof completion === "number" && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Profile completion</span>
            <span className="text-sm tabular-nums text-muted-foreground">{completion}%</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={completion}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Profile completion"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <Detail label="Professional title" value={card?.professionalTitle ?? null} />
        <Detail label="Brokerage" value={card?.brokerageOffice ?? null} />
        <Detail label="Location" value={card?.locationDisplay ?? null} />
        <Detail label="Email" value={card?.publicContactEmail ?? null} />
        <Detail label="Phone" value={formatPhoneDisplay(card?.phoneE164)} />
        <Detail label="Licence" value={licence} />
        <Detail label="NRDS ID" value={profile?.nrdsNumber ?? null} />
        <Detail label="MLS agent ID" value={mlsId} />
        <Detail label="MLS or board" value={board} />
      </dl>

      {/* Stated plainly wherever the identity appears. Recording an MLS id is
          not the same as having verified it, and this surface must not imply
          otherwise by staying quiet. */}
      {mlsId && (
        <p className="text-[12px] text-foreground/55">
          MLS identity is self-reported —{" "}
          <span className="font-medium text-foreground">
            {mlsStatusLabel(profile?.mlsVerificationStatus ?? "unverified")}
          </span>
          .
        </p>
      )}

      <Button
        className="h-10 w-full min-w-0 px-3 text-[13px]"
        onClick={onEdit}
      >
        <Pencil aria-hidden />
        <span className="truncate">Edit profile</span>
      </Button>
    </div>
  );
}
