"use client";

/**
 * The internal digital business card.
 *
 * Internal by design: there is no public share URL in this release, so the card
 * only ever renders data the signed-in user already has on screen, and the
 * vCard is generated in the browser on demand and never stored.
 *
 * Structured as a card rather than a settings table. The previous layout was a
 * single column of label/value rows separated by full-width rules, which is the
 * visual language of an account-settings page — it read as a form the user had
 * failed to finish rather than as something they would hand to a client.
 *
 * Accessibility is delegated to Radix Dialog via the shared Sheet primitive,
 * which supplies the focus trap, Escape-to-close, `aria-modal` and focus
 * restoration to the trigger.
 */
import * as React from "react";
import Link from "next/link";
import {
  Briefcase,
  Check,
  Copy,
  Download,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  LogOut,
  Mail,
  MessageCircle,
  SquarePen,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PROFILE_STATUS_LABEL,
  formatJoinedAt,
  type HomeIdentityCard as HomeIdentityCardData,
} from "@/lib/profile/home-card";
import { buildContactBlock, formatPhoneDisplay, toWhatsApp } from "@/lib/profile/links";
import { safeLinkUrl } from "@/lib/profile/display";
import { buildVCard, vCardFilename } from "@/lib/profile/vcard";
import { ROUTES } from "@/lib/routes";
import { SignOutLink } from "@/components/layout/sign-out-link";
import { cn, initials } from "@/lib/utils";

/**
 * Shown when no professional title has been entered.
 *
 * Deliberately NOT the account role. "Member" describes someone's relationship
 * with the FortMark dashboard, not the work they do, and printing it where a
 * recipient expects a profession is simply wrong. A neutral, accurate
 * description is better than an accurate answer to a different question.
 */
export const DEFAULT_PROFESSIONAL_TITLE = "Real Estate Professional";

/**
 * A URL as a person would read it.
 *
 * `https://` and a trailing slash are noise in a detail cell and make long
 * values wrap worse. The full href is still what any action links to — this
 * only affects the text.
 */
function displayUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** One detail cell. Absent optional values hold their place and say so. */
function Detail({
  label,
  value,
  always = false,
}: {
  label: string;
  value: string | null;
  always?: boolean;
}) {
  if (!value && !always) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/55">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 break-words text-[14px] leading-snug",
          value ? "font-semibold text-foreground" : "font-normal text-foreground/55"
        )}
      >
        {/* Same wording as the onboarding Review, so one absent value is not
            "Not added" on one surface and "Pending" on another. */}
        {value ?? "Not added"}
      </p>
    </div>
  );
}

/**
 * Account status, read-only.
 *
 * Colour is never the only signal — the word itself is the status — so this
 * stays legible to a colour-blind reader and in a greyscale print of the card.
 */
function StatusPill({ status }: { status: "active" | "inactive" }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        active
          ? "border-foreground/20 bg-foreground/[0.04] text-foreground"
          : "border-border bg-transparent text-foreground/55"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-600 dark:bg-emerald-400" : "bg-foreground/30"
        )}
      />
      {PROFILE_STATUS_LABEL[status]}
    </span>
  );
}

/** A contact action. Rendered only when the underlying value exists. */
function ContactAction({
  href,
  icon: Icon,
  label,
  external,
}: {
  href: string;
  icon: typeof Mail;
  label: string;
  external?: boolean;
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-10 min-w-0 flex-1 border-foreground/45 px-2 text-[12px]"
    >
      <a
        href={href}
        aria-label={label}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        <Icon aria-hidden />
        <span className="truncate">{label}</span>
      </a>
    </Button>
  );
}

export function DigitalBusinessCard({
  data,
  open,
  onOpenChange,
  showSignOut = false,
}: {
  data: HomeIdentityCardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Offer sign out from the card.
   *
   * Only the account drawer sets this: that card is "you", so signing out
   * belongs on it. Home's card is a shareable artefact and must not carry an
   * account action.
   */
  showSignOut?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Carried on the card rather than scraped from `links`: the Home self-card
  // hides the email/phone entries, and this card must not lose them with it.
  //
  // The RESOLVED public address: the alternative email when the user entered
  // one, otherwise their account email. Selected once in
  // `publicContactEmail` so this card, the vCard and the clipboard block
  // cannot disagree about which address is published.
  const email = data.publicContactEmail ?? data.businessEmail;
  const phone = data.phoneE164;
  const whatsapp = toWhatsApp(data.whatsappPhoneE164);

  // Every href re-checked against the scheme allowlist on the way out. These
  // round-trip through the database, so the read gate matters as much as the
  // write gate did.
  const linkOf = (kind: string) =>
    safeLinkUrl(data.links.find((l) => l.kind === kind)?.href);
  const personalWebsite = linkOf("website");
  const professionalWebsite = linkOf("professionalWebsite");
  const linkedin = linkOf("linkedin");
  const instagram = linkOf("instagram");
  const facebook = linkOf("facebook");
  // Kept separate above so the details section can name each one, but the
  // exports want a single canonical site, professional first.
  const website = professionalWebsite ?? personalWebsite;

  /**
   * The top row is PUBLIC/SOCIAL actions only.
   *
   * Email and Call are direct-contact actions, and this card is the agent
   * looking at what they hand to a client — the values still belong on the
   * card, but as readable detail rather than a button. WhatsApp stays because
   * it is an external `wa.me` link that behaves like the social entries rather
   * than like a self-directed shortcut.
   */
  const socialActions = [
    linkedin && { href: linkedin, icon: Linkedin, label: "LinkedIn" },
    instagram && { href: instagram, icon: Instagram, label: "Instagram" },
    facebook && { href: facebook, icon: Facebook, label: "Facebook" },
    personalWebsite && { href: personalWebsite, icon: Globe, label: "Website" },
    professionalWebsite && {
      href: professionalWebsite,
      icon: Briefcase,
      label: "Professional site",
    },
    whatsapp && { href: whatsapp, icon: MessageCircle, label: "WhatsApp" },
  ].filter(Boolean) as Array<{ href: string; icon: typeof Mail; label: string }>;

  const joined = formatJoinedAt(data.joinedAt);
  const title = data.professionalTitle ?? DEFAULT_PROFESSIONAL_TITLE;

  const contactBlock = () =>
    buildContactBlock({
      displayName: data.displayName,
      professionalTitle: data.professionalTitle,
      roleLabel: data.roleLabel,
      brokerageOffice: data.brokerageOffice,
      locationDisplay: data.locationDisplay,
      licenseState: data.licenseState,
      licenseType: data.licenseType,
      licenseNumber: data.licenseNumber,
      email,
      phoneE164: phone,
      professionalWebsiteUrl: website,
    });

  async function copyContact() {
    try {
      await navigator.clipboard.writeText(contactBlock());
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  function downloadVCard() {
    const vcf = buildVCard({
      displayName: data.displayName,
      professionalTitle: data.professionalTitle,
      roleLabel: data.roleLabel,
      brokerageOffice: data.brokerageOffice,
      locationDisplay: data.locationDisplay,
      email,
      phoneE164: phone,
      websiteUrl: website,
      licenseState: data.licenseState,
      licenseType: data.licenseType,
      licenseNumber: data.licenseNumber,
      nrdsNumber: data.nrdsNumber,
    });
    // Generated, handed to the browser, and revoked — never persisted.
    const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = vCardFilename(data.displayName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[440px] sm:max-w-none lg:w-[460px]"
        aria-label="Your FortMark digital card"
      >
        {/* pr-12 keeps the close button clear of the title. */}
        <SheetHeader className="border-b border-border p-4 pr-12">
          <SheetTitle className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            FortMark
          </SheetTitle>
          <SheetDescription className="text-[12px]">Digital business card</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          {/* pb-6 rather than a flush edge: on Preview deployments Vercel injects
              a floating toolbar in the lower corner, and content ending hard
              against the edge sits underneath it. */}
          <div className="px-5 pb-6 pt-6">
            <div className="flex flex-col items-center text-center">
              {/* 104px on mobile, 128px from sm up — the card's anchor, not a
                  thumbnail. The fallback uses the same frame so the layout does
                  not shift between a photo and initials. */}
              <Avatar className="size-[104px] rounded-panel sm:size-[128px]">
                {data.imageUrl && (
                  <AvatarImage src={data.imageUrl} alt="" className="object-cover" />
                )}
                <AvatarFallback className="rounded-panel text-2xl font-semibold sm:text-3xl">
                  {initials(data.displayName)}
                </AvatarFallback>
              </Avatar>

              <h2 className="mt-4 text-[22px] font-bold leading-tight tracking-tight">
                {data.displayName}
              </h2>
              {/* The profession, never the account role. */}
              <p className="mt-1 text-[15px] font-medium text-foreground/75">{title}</p>
              <p className="mt-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground/55">
                FortMark
              </p>
              {data.locationDisplay && (
                <p className="mt-1 text-[13px] text-foreground/55">{data.locationDisplay}</p>
              )}

              <StatusPill status={data.profileStatus} />
            </div>

            {/* Public/social actions only — no Email, no Call. The row vanishes
                entirely when there is nothing to link to, rather than leaving
                disabled placeholders behind. */}
            {socialActions.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {socialActions.map((a) => (
                  <ContactAction
                    key={a.label}
                    href={a.href}
                    icon={a.icon}
                    label={a.label}
                    external
                  />
                ))}
              </div>
            )}

            <section aria-labelledby="dc-details" className="mt-6">
              <h3
                id="dc-details"
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/55"
              >
                Professional details
              </h3>
              {/* Two columns from sm up, one on mobile. Spacing and a single
                  panel do the grouping, so there is no rule under every field. */}
              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-4 rounded-panel border border-border bg-foreground/[0.02] p-4 sm:grid-cols-2">
                <Detail label="License number" value={data.licenseNumber} always />
                <Detail label="NRDS ID" value={data.nrdsNumber} always />
                {/* Only when populated: an empty licence TYPE tells a recipient
                    nothing, unlike the two identifiers above which are the
                    fields people look for. */}
                <Detail label="License type" value={data.licenseType} />
                <Detail label="License state" value={data.licenseState} />
                {/* Email and Phone read as information here rather than as
                    buttons above. `email` is the business address only. */}
                <Detail label="Email" value={email} />
                <Detail label="Phone" value={formatPhoneDisplay(phone)} />
                <Detail label="Member since" value={joined} />
                <Detail label="Location" value={data.locationDisplay} />
                <Detail label="Website" value={displayUrl(personalWebsite)} />
                <Detail label="Professional site" value={displayUrl(professionalWebsite)} />
              </div>
            </section>
          </div>
        </ScrollArea>

        {/* An even 2x2 block. Every action gets the same weight, width and
            height, so nothing floats out of line — a mix of outlined and
            borderless buttons read as misaligned even when their boxes were
            not.

            There is no "Close": the sheet already has a close control in its
            corner, and a second one only competed with the actions people
            actually came here for. */}
        <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
          <Button size="sm" variant="outline" className="w-full justify-center" onClick={copyContact}>
            {copied ? <Check /> : <Copy />}
            <span className="truncate">{copied ? "Copied" : "Copy contact"}</span>
          </Button>
          <Button size="sm" variant="outline" className="w-full justify-center" onClick={downloadVCard}>
            <Download />
            <span className="truncate">Download vCard</span>
          </Button>
          {/* Always the settings page. Editing lives in exactly one place, so
              a field cannot exist on one surface with different rules on
              another — and closing the sheet as we navigate stops it hanging
              over the page we just moved to. */}
          <Button asChild size="sm" variant="outline" className="w-full justify-center">
            <Link
              href={`${ROUTES.settings}?tab=profile&edit=1`}
              onClick={() => onOpenChange(false)}
            >
              <SquarePen />
              <span className="truncate">Edit profile</span>
            </Link>
          </Button>
          {showSignOut && (
            /* Matches the Button outline + sm classes exactly, so it sits in
               the grid as an equal rather than an approximation. */
            <SignOutLink className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-card px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent">
              <LogOut aria-hidden className="size-4 shrink-0" />
              <span className="truncate">Sign out</span>
            </SignOutLink>
          )}
          <p aria-live="polite" className="sr-only">
            {copied ? "Contact information copied to the clipboard" : ""}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
