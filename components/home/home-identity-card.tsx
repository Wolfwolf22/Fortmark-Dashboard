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
  type HomeIdentityCard as HomeIdentityCardData,
} from "@/lib/profile/home-card";
import { buildContactBlock, type ContactLinkKind } from "@/lib/profile/links";
import { ROUTES } from "@/lib/routes";
import { useUiStore } from "@/lib/stores/ui";
import { cn, initials } from "@/lib/utils";

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

/** Small caps metadata label, matching the dashboard's existing micro type. */
function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
      <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums">
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </p>
    </div>
  );
}

export function HomeIdentityCard({ data }: { data: HomeIdentityCardData }) {
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);
  const [cardOpen, setCardOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const joined = formatJoinedAt(data.joinedAt);
  const trustLabel = CREDENTIAL_TRUST_LABEL[data.credentialTrust];
  const trustIsWarning = data.credentialTrust === "expired";

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
      email: data.links.find((l) => l.kind === "email")?.href.replace(/^mailto:/, "") ?? null,
      phoneE164: data.links.find((l) => l.kind === "phone")?.href.replace(/^tel:/, "") ?? null,
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
      className="flex h-full flex-col gap-5 p-6"
      aria-labelledby="home-identity-heading"
    >
      {/* GREETING ---------------------------------------------------------- */}
      <div>
        <h2 id="home-identity-heading" className="text-display text-xl leading-tight">
          {data.greetingName ? `Welcome back, ${data.greetingName}` : "Welcome back"}
        </h2>
        <TodayLine />
      </div>

      {/* HEADSHOT + IDENTITY ---------------------------------------------- */}
      <div className="flex items-center gap-4 sm:block">
        <Avatar className="h-[72px] w-[72px] shrink-0 rounded-panel sm:h-24 sm:w-24">
          {data.imageUrl && <AvatarImage src={data.imageUrl} alt="" className="object-cover" />}
          <AvatarFallback className="rounded-panel text-lg">
            {initials(data.displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 sm:mt-4">
          <p className="truncate text-[17px] font-bold leading-tight">{data.displayName}</p>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {data.professionalTitle ?? data.roleLabel}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {["FortMark", data.brokerageOffice ?? data.locationDisplay]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {joined && <p className="mt-0.5 text-micro">Joined {joined}</p>}
        </div>
      </div>

      {/* CREDENTIAL GRID -------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
        <CredentialCell label={licence ? `${licence} license` : "License"} value={data.licenseNumber} />
        <CredentialCell label="NRDS ID" value={data.nrdsNumber} />
        <CredentialCell label="Member since" value={joined} />
        <div className="min-w-0">
          <MetaLabel>Status</MetaLabel>
          {/* Not colour-only: an icon and text carry the meaning too. */}
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1 truncate text-[13px] font-semibold",
              trustIsWarning ? "text-destructive" : "text-muted-foreground"
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

      {/* SOCIAL ROW ------------------------------------------------------- */}
      {data.links.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
          {data.links.map((link) => {
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>{link.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* COMPLETION ------------------------------------------------------- */}
      <Link
        href={`${ROUTES.settings}?tab=profile`}
        className="group -mx-1 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted-foreground group-hover:text-foreground">
            Profile {data.completion}% complete
          </span>
          <span className="text-micro underline-offset-2 group-hover:underline">Complete</span>
        </span>
        <span
          className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={data.completion}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Profile ${data.completion}% complete`}
        >
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${data.completion}%` }}
          />
        </span>
      </Link>

      {/* ACTIONS ---------------------------------------------------------- */}
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-4">
        <Button asChild size="sm" variant="outline">
          <Link href={`${ROUTES.settings}?tab=profile`}>
            <SquarePen />
            Edit profile
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setQuickCreate("transaction")}>
          <Plus />
          New transaction
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCardOpen(true)}>
          <IdCard />
          Digital card
        </Button>
        <Button size="sm" variant="ghost" onClick={copyContact}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy contact"}
        </Button>
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
    <p className="mt-1 min-h-[1.25rem] text-[13px] text-muted-foreground">{today ?? ""}</p>
  );
}
