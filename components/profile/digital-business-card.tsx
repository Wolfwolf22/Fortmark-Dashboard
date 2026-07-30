"use client";

/**
 * The internal digital business card.
 *
 * Internal by design: there is no public share URL in this release, so the card
 * only ever renders data the signed-in user already has on screen, and the
 * vCard is generated in the browser on demand and never stored.
 *
 * Accessibility is delegated to Radix Dialog via the shared Sheet primitive,
 * which supplies the focus trap, Escape-to-close, `aria-modal` and focus
 * restoration to the trigger.
 */
import * as React from "react";
import Link from "next/link";
import { Check, Copy, Download, SquarePen } from "lucide-react";
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
  CREDENTIAL_TRUST_LABEL,
  formatJoinedAt,
  type HomeIdentityCard as HomeIdentityCardData,
} from "@/lib/profile/home-card";
import { buildContactBlock, formatPhoneDisplay } from "@/lib/profile/links";
import { buildVCard, vCardFilename } from "@/lib/profile/vcard";
import { ROUTES } from "@/lib/routes";
import { initials } from "@/lib/utils";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[13px] font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function DigitalBusinessCard({
  data,
  open,
  onOpenChange,
}: {
  data: HomeIdentityCardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const email = data.links.find((l) => l.kind === "email")?.href.replace(/^mailto:/, "") ?? null;
  const phone = data.links.find((l) => l.kind === "phone")?.href.replace(/^tel:/, "") ?? null;
  const website =
    data.links.find((l) => l.kind === "professionalWebsite")?.href ??
    data.links.find((l) => l.kind === "website")?.href ??
    null;
  const joined = formatJoinedAt(data.joinedAt);
  const licence =
    [data.licenseState, data.licenseType, data.licenseNumber].filter(Boolean).join(" ") || null;

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
        className="flex w-full flex-col gap-0 p-0 sm:w-[400px] sm:max-w-none lg:w-[440px]"
        aria-label="Your FortMark digital card"
      >
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            FortMark
          </SheetTitle>
          <SheetDescription>Digital business card</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-24 w-24 rounded-panel">
                {data.imageUrl && (
                  <AvatarImage src={data.imageUrl} alt="" className="object-cover" />
                )}
                <AvatarFallback className="rounded-panel text-xl">
                  {initials(data.displayName)}
                </AvatarFallback>
              </Avatar>
              <p className="mt-4 text-lg font-bold leading-tight">{data.displayName}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {data.professionalTitle ?? data.roleLabel}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {["FortMark", data.brokerageOffice ?? data.locationDisplay]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <div className="mt-6">
              <Row label="Role" value={data.roleLabel} />
              <Row label="License" value={licence} />
              <Row label="NRDS ID" value={data.nrdsNumber} />
              <Row label="Email" value={email} />
              <Row label="Phone" value={formatPhoneDisplay(phone)} />
              <Row label="Website" value={website} />
              <Row label="Joined" value={joined} />
              <Row label="Status" value={CREDENTIAL_TRUST_LABEL[data.credentialTrust]} />
            </div>
          </div>
        </ScrollArea>

        <div className="grid grid-cols-2 gap-2 border-t border-border p-5">
          <Button size="sm" variant="outline" onClick={copyContact}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy contact"}
          </Button>
          <Button size="sm" variant="outline" onClick={downloadVCard}>
            <Download />
            Download vCard
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`${ROUTES.settings}?tab=profile`}>
              <SquarePen />
              Edit profile
            </Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <p aria-live="polite" className="sr-only">
            {copied ? "Contact information copied to the clipboard" : ""}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
