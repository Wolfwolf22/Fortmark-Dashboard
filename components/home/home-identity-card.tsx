"use client";

/**
 * The permanent Home identity card.
 *
 * Fixed by construction, not by configuration: it is rendered as the grid's
 * first child *outside* the sortable item list, so it has no drag handle, no
 * expand control and no remove control, and cannot be reordered away. See
 * `bento-grid.tsx`.
 *
 * Data arrives as a prop from the server-rendered Home page — it is never read
 * from the global layout/UI stores, so nothing here widens global client state.
 * The card is a client component only because Copy Contact, the digital card
 * and the tooltips need interactivity.
 */
import * as React from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Check,
  Copy,
  Facebook,
  Globe,
  IdCard,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  ShieldAlert,
  SquarePen,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DigitalBusinessCard } from "@/components/profile/digital-business-card";
import {
  CREDENTIAL_TRUST_LABEL,
  formatJoinedAt,
  selfCardLinks,
  type HomeIdentityCard as HomeIdentityCardData,
} from "@/lib/profile/home-card";
import { buildContactBlock, type ContactLinkKind } from "@/lib/profile/links";
import { ROUTES } from "@/lib/routes";
import { useUiStore } from "@/lib/stores/ui";
import { cn, initials } from "@/lib/utils";

/**
 * Short, action-shaped labels for the single-contact case.
 *
 * `ContactLink.label` is the accessible name and tooltip ("LinkedIn profile",
 * "Send email") and stays exactly as it is. This is a presentation-only map for
 * the visible text when there is one link and an unexplained icon would not say
 * what it does — it adds no field and reads nothing new from the profile.
 */
const LINK_ACTION: Record<ContactLinkKind, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  website: "Website",
  professionalWebsite: "Professional site",
  email: "Email",
  phone: "Call",
  whatsapp: "WhatsApp",
};

const LINK_ICON: Record<ContactLinkKind, React.ComponentType<{ className?: string }>> = {
  linkedin: Linkedin,
  instagram: Instagram,
  facebook: Facebook,
  website: Globe,
  professionalWebsite: Building2,
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
};

/**
 * Small caps metadata label.
 *
 * Uses `text-foreground` at reduced opacity rather than `text-muted-foreground`.
 * That token is `0 0% 55%` in *both* themes, which reads at roughly 3.5:1 on a
 * white card — under AA for text this size. Deriving the label from the
 * foreground instead makes it symmetric: ~8.6:1 in light, ~9.9:1 in dark, with
 * no change to any global token and no theme-specific rule.
 */
function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/70">
      {children}
    </span>
  );
}

function CredentialCell({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="min-w-0">
      <MetaLabel>{label}</MetaLabel>
      <p className="mt-1 truncate text-[13px] font-medium tabular-nums text-foreground">
        {/* Honest absence, still legible: ~4.7:1 light, ~5.7:1 dark. */}
        {value ?? <span className="font-normal text-foreground/55">Not added</span>}
      </p>
    </div>
  );
}

export function HomeIdentityCard({ data }: { data: HomeIdentityCardData }) {
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);
  const [cardOpen, setCardOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Email and Call are dropped here and nowhere else. This card is the user
  // looking at their own record; the Digital Card, which is shareable, keeps
  // the full set.
  const visibleLinks = React.useMemo(() => selfCardLinks(data.links), [data.links]);

  React.useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const joined = formatJoinedAt(data.joinedAt);
  // No trust level at all on a session-only card: nothing has been reported, so
  // there is nothing to characterise. "Not added" is the honest label.
  const trustLabel = data.credentialTrust
    ? CREDENTIAL_TRUST_LABEL[data.credentialTrust]
    : "Not added";
  const trustIsWarning = data.credentialTrust === "expired";

  /**
   * No database record at all. Governs what the Digital Card can be built from,
   * so it stays exactly as it was — a data-availability question, not a
   * presentation one.
   */
  const setupRequired = data.completion === null;

  /**
   * Whether to render a measured completion bar.
   *
   * A zero-width track reads as a broken control rather than as "0%", and it
   * tells the user nothing the callout does not say better. Both no-record and
   * a genuine zero therefore render the callout. Nothing is fabricated in
   * either case: a real percentage is only ever shown when the service
   * returned one above zero.
   */
  const hasMeasuredCompletion = data.completion !== null && data.completion > 0;

  const licence =
    [data.licenseState, data.licenseType].filter(Boolean).join(" ") || null;

  async function copyContact() {
    const block = buildContactBlock({
      displayName: data.displayName,
      professionalTitle: data.professionalTitle,
      roleLabel: data.roleLabel,
      brokerageOffice: data.brokerageOffice,
      locationDisplay: data.locationDisplay,
      licenseState: data.licenseState,
      licenseType: data.licenseType,
      licenseNumber: data.licenseNumber,
      // Rebuilt from the already-validated link list so nothing unvalidated is
      // copied, and so the block matches exactly what the card displays.
      // Carried on the card, not recovered from the link list: the self-card no
      // longer renders email/phone links, and Copy Contact must not lose them.
      // Business email only. The account address is private identity data and
      // is never published into a clipboard block.
      email: data.businessEmail,
      phoneE164: data.phoneE164,
      linkedinUrl: data.links.find((l) => l.kind === "linkedin")?.href ?? null,
      personalWebsiteUrl: data.links.find((l) => l.kind === "website")?.href ?? null,
      professionalWebsiteUrl:
        data.links.find((l) => l.kind === "professionalWebsite")?.href ?? null,
    });
    try {
      // Success is reported only after the clipboard write actually resolves.
      await navigator.clipboard.writeText(block);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card
      // `md:row-span-2` on the wrapper in bento-grid.tsx sets the footprint;
      // h-full makes the card fill it so it lines up with the KPI rows.
      // Border is lifted from the shared card border so the credential card
      // reads as its own object against the KPI tiles beside it, without a
      // glow, gradient or heavier shadow.
      className="flex h-full min-w-0 flex-col gap-4 p-6 ring-1 ring-inset ring-foreground/[0.06]"
      aria-labelledby="home-identity-heading"
    >
      {/* GREETING ---------------------------------------------------------- */}
      <div>
        {/* /70 rather than /55: legible at 10px (8.52:1 light, 9.44:1 dark)
            while staying well under the greeting, which is full foreground. */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
          My FortMark
        </p>
        {/* Deliberately not `text-display`: that utility forces uppercase, and
            the greeting is a sentence addressed to a person, not a banner. */}
        <h2
          id="home-identity-heading"
          className="mt-1.5 text-[20px] font-semibold leading-tight tracking-[-0.01em] lg:text-[22px]"
        >
          {data.greetingName ? `Welcome back, ${data.greetingName}` : "Welcome back"}
        </h2>
        <TodayLine />
      </div>

      {/* HEADSHOT + IDENTITY ---------------------------------------------- */}
      <div className="flex items-center gap-4">
        <Avatar className="h-[76px] w-[76px] shrink-0 rounded-panel sm:h-[84px] sm:w-[84px] lg:h-[92px] lg:w-[92px]">
          {data.imageUrl && (
            <AvatarImage
              src={data.imageUrl}
              alt={`${data.displayName} profile photo`}
              className="object-cover"
            />
          )}
          <AvatarFallback className="rounded-panel text-xl">
            {initials(data.displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold leading-tight">{data.displayName}</p>

          {data.professionalTitle ? (
            <p className="mt-1 truncate text-[13px] text-foreground/70">
              {data.professionalTitle}
            </p>
          ) : (
            // Sentence case, and only when the completion callout is not already
            // making the same request lower down — one ask, not two.
            hasMeasuredCompletion && (
              <Link
                href={`${ROUTES.settings}?tab=profile`}
                className="mt-1 block truncate text-[13px] text-foreground/70 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Complete your professional profile
              </Link>
            )
          )}

          <p className="mt-1 truncate text-[12px] text-foreground/55">
            {[data.roleLabel, "FortMark"].filter(Boolean).join(" · ")}
          </p>

          {/* Location only. The line above already says FortMark, and since
              brokerage became a fixed value this fell back to printing
              "FORTMARK" directly beneath "Member · FortMark". */}
          {data.locationDisplay && (
            <p className="mt-0.5 truncate text-[12px] text-foreground/55">
              {data.locationDisplay}
            </p>
          )}
        </div>
      </div>

      {/* CREDENTIAL GRID -------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-5">
        <CredentialCell label={licence ? `${licence} license` : "License"} value={data.licenseNumber} />
        <CredentialCell label="NRDS ID" value={data.nrdsNumber} />
        <CredentialCell label="Member since" value={joined} />
        <div className="min-w-0">
          <MetaLabel>Status</MetaLabel>
          {/* Not colour-only: an icon and text carry the meaning too. */}
          <p
            className={cn(
              "mt-1 flex items-center gap-1 truncate text-[13px] font-medium",
              trustIsWarning ? "text-destructive" : "text-foreground"
            )}
          >
            {trustIsWarning ? (
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {trustLabel}
          </p>
        </div>
      </div>

      {/* CONTACT ---------------------------------------------------------
          Grouped with the credentials above rather than separated by its own
          rule: a lone bordered row under the grid read as a floating toolbar
          with no stated purpose. Nothing renders at all when there are no
          links, so no empty row is left behind. */}
      {visibleLinks.length === 1 &&
        (() => {
          // One link, so an icon alone would not say what it does. The visible
          // text names the action; the accessible name stays the fuller label.
          const link = visibleLinks[0];
          const Icon = LINK_ICON[link.kind];
          return (
            <a
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              aria-label={link.external ? `${link.label} (opens in a new tab)` : link.label}
              className="-mt-1 inline-flex h-9 w-fit min-w-0 items-center gap-2 rounded-lg border border-foreground/45 px-3 text-[13px] font-semibold text-foreground transition-colors hover:border-foreground/60 hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-[17px] w-[17px] shrink-0" />
              <span className="truncate">{LINK_ACTION[link.kind]}</span>
            </a>
          );
        })()}

      {visibleLinks.length > 1 && (
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          {visibleLinks.map((link) => {
            const Icon = LINK_ICON[link.kind];
            return (
              <Tooltip key={link.kind}>
                <TooltipTrigger asChild>
                  <a
                    href={link.href}
                    {...(link.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    aria-label={
                      link.external ? `${link.label} (opens in a new tab)` : link.label
                    }
                    // Monochrome on purpose — no network brand colours, so the
                    // row reads as one control group rather than a logo strip.
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-foreground/45 text-foreground/70 transition-colors hover:border-foreground/60 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>{link.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* COMPLETION ------------------------------------------------------- */}
      {hasMeasuredCompletion ? (
        // STATE B — a real, non-zero score from the completion service.
        <Link
          href={`${ROUTES.settings}?tab=profile`}
          className="group -mx-1 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-foreground/70 group-hover:text-foreground">
              Profile {data.completion}% complete
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/55 underline-offset-2 group-hover:text-foreground group-hover:underline">
              Complete
            </span>
          </span>
          <span
            className="mt-2 block h-1 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuenow={data.completion ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Profile ${data.completion}% complete`}
          >
            {/* Flat fill, no gradient and no accent colour — the bar is a
                measurement, not a decoration. */}
            <span
              className="block h-full rounded-full bg-foreground/70 transition-[width] duration-300"
              style={{ width: `${data.completion}%` }}
            />
          </span>
        </Link>
      ) : (
        // STATE A — no record, or a genuine zero. A callout, never an empty
        // track: a 0%-wide bar reads as broken rather than as a measurement.
        <Link
          href={`${ROUTES.settings}?tab=profile`}
          className="block rounded-panel border border-border bg-foreground/[0.03] p-4 transition-colors hover:border-foreground/45 hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <SquarePen className="h-4 w-4 shrink-0" aria-hidden />
            Complete your professional profile
          </span>
          <span className="mt-1 block text-[12px] leading-snug text-foreground/70">
            Add your title, credentials, contact details and professional links.
          </span>
        </Link>
      )}

      {/* ACTIONS ---------------------------------------------------------- */}
      <div className="mt-auto space-y-2 border-t border-border pt-5">
        {/* Primary row. `default` is the filled variant — white on black in
            dark mode, black on white in light — so intent is unambiguous.

            `min-w-0` + a truncating label are load-bearing, not cosmetic. The
            grid track is `minmax(0, 1fr)`, but the button base sets
            `whitespace-nowrap`, so a label wider than its share would spill
            outside the card and scroll the page. The narrowest real case is the
            pinned rail at 1280px, which leaves each of these about 130px. */}
        <div className="grid grid-cols-2 gap-2">
          <Button asChild size="lg" className="h-10 min-w-0 px-3 text-[13px]">
            <Link href={`${ROUTES.settings}?tab=profile`}>
              <SquarePen />
              <span className="truncate">Edit profile</span>
            </Link>
          </Button>
          {/* `--input` is 0 0% 18% against a 0 0% 7% card, which measures
              1.38:1 — the border was effectively invisible in dark mode.
              `foreground/45` is the lowest value clearing the 3:1 non-text
              threshold in BOTH themes (3.35:1 light, 4.53:1 dark) and still
              reads as clearly secondary to the filled primary beside it. */}
          <Button
            size="lg"
            variant="outline"
            className="h-10 min-w-0 border-foreground/45 px-3 text-[13px] hover:border-foreground/70 hover:bg-accent"
            onClick={() => setQuickCreate("transaction")}
          >
            <Plus />
            <span className="truncate">New transaction</span>
          </Button>
        </div>

        {/* Tertiary row.

            The boundary sits at /45, the same as New Transaction, because a
            border that communicates "this is a control" has to clear the 3:1
            non-text threshold to do that job — 2.11:1 in light mode did not.
            (/42 is the first value that technically passes at 3.04:1; /45 is
            the standard step and leaves margin.) Subordination is carried by
            everything except contrast instead: 36px rather than 40px from `sm`
            up, a transparent rather than card-filled background, 12px text with
            a smaller glyph, and a lighter hover wash than the secondary above.

            Disabled state is not colour-only: `disabled:border-dashed` changes
            the boundary's SHAPE, so it reads as unavailable to someone who
            cannot distinguish the dimming that `disabled:opacity-40` applies.
            The `disabled` attribute keeps the semantics and the
            `aria-describedby` explanation stays reachable. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-10 min-w-0 border-foreground/45 bg-transparent px-3 text-[12px] hover:border-foreground/60 hover:bg-foreground/[0.05] disabled:border-dashed sm:h-9 [&_svg]:size-3.5"
            onClick={() => setCardOpen(true)}
            // Nothing to put on a business card until a profile record exists.
            disabled={setupRequired}
            title={setupRequired ? "Add your profile details first" : undefined}
            aria-describedby={setupRequired ? "home-identity-card-disabled" : undefined}
          >
            <IdCard />
            <span className="truncate">Digital card</span>
          </Button>
          <Button
            variant="outline"
            className="h-10 min-w-0 border-foreground/45 bg-transparent px-3 text-[12px] hover:border-foreground/60 hover:bg-foreground/[0.05] sm:h-9 [&_svg]:size-3.5"
            onClick={copyContact}
          >
            {copied ? <Check /> : <Copy />}
            <span className="truncate">{copied ? "Copied" : "Copy contact"}</span>
          </Button>
        </div>

        {/* A disabled control cannot hold focus, so the reason is exposed as
            referenced text rather than relying on the tooltip alone. */}
        {setupRequired && (
          <p id="home-identity-card-disabled" className="sr-only">
            Digital card is unavailable until your profile details are added.
          </p>
        )}
        {/* Announced to assistive tech only after the write resolved. */}
        <p aria-live="polite" className="sr-only">
          {copied ? "Contact information copied to the clipboard" : ""}
        </p>
      </div>

      <DigitalBusinessCard data={data} open={cardOpen} onOpenChange={setCardOpen} />
    </Card>
  );
}

/**
 * "Tuesday, July 29" in the viewer's own locale.
 *
 * Rendered empty on the server and filled after mount. Formatting a date with
 * the browser locale during SSR is the classic hydration mismatch, so the value
 * is only ever computed client-side.
 */
function TodayLine() {
  const [today, setToday] = React.useState<string | null>(null);
  React.useEffect(() => {
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    );
  }, []);
  return (
    <p className="mt-1 min-h-[1.25rem] text-[13px] text-foreground/55">{today ?? ""}</p>
  );
}
