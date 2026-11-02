"use client";

import Link from "next/link";
import { useRef } from "react";
import { Building2, CalendarClock, Copy, MoreHorizontal, NotebookPen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import { ListingImage } from "@/components/listings/listing-image";
import { specLine } from "@/components/listings/listing-meta";
import type { Listing } from "@/lib/data/types";
import { type AddPropertyInput, type PropertyLookup, type PropertyPage, type PropertyView } from "@/lib/contacts/properties";
import { BUSINESS_TIME_ZONE } from "@/lib/metrics/business-day";
import { formatCurrency } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { REVIEW_LABELS } from "@/components/property-lists/research";

interface ContactPropertiesProps { contactId: string; canWrite: boolean; available: boolean; refreshKey?: number }
export interface ContactPropertyPreview { query: string; result: PropertyLookup }
export interface ContactPropertyPageAnswer { requestPage: number; result: PropertyPage }
const checkedStamp = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export function normalizePropertySearch(value: string): string { return value.trim().toUpperCase(); }
export function propertyPreviewMatchesInput(preview: ContactPropertyPreview | null, input: string): boolean {
  return Boolean(preview && preview.query === normalizePropertySearch(input));
}
/** The save is bound to the exact MLS dataset and listing the person reviewed. */
export function reviewedContactPropertyAddInput(preview: ContactPropertyPreview): AddPropertyInput {
  return { mlsNumber: preview.query, expectedListingId: preview.result.listing.id, expectedDataset: preview.result.dataset };
}
/** Clear a draft only after its own contact and reviewed listing were acknowledged. */
export function confirmedPropertyAddState(property: PropertyView | null | undefined, contactId: string, preview: ContactPropertyPreview): { query: ""; preview: null; propertyId: string } | null {
  return property?.id && property.contactId === contactId && property.listingId === preview.result.listing.id && normalizePropertySearch(property.mlsNumber) === preview.query
    ? { query: "", preview: null, propertyId: property.id } : null;
}
/** Only a settled answer to the current request may recover a shrunken page. */
export function contactPropertyPageRecovery(requestPage: number, answer: ContactPropertyPageAnswer | null | undefined, settled: boolean): number | null {
  if (!settled || !answer || answer.requestPage !== requestPage) return null;
  const last = Math.max(1, Math.ceil(answer.result.total / Math.max(1, answer.result.pageSize)));
  const target = Math.max(1, Math.min(answer.result.page, last));
  return target === requestPage ? null : target;
}
export function contactPropertyFailure(error: unknown, operation: "lookup" | "add" | "remove" | "read"): string {
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
  const code = typeof rawCode === "string" ? rawCode.toLowerCase().replace(/\s+/g, "_") : null;
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (code === "invalid_property") return "Enter an MLS number using up to 40 letters, numbers or hyphens, including at least one number.";
  if (code === "listing_not_found") return "No property was returned for this exact MLS number. Check the number and try again.";
  if (code === "ambiguous") return "The MLS returned more than one property for this number. Confirm the MLS number before trying again.";
  if (code === "listing_changed") return "This MLS number now points to a different listing. Find the property again before adding it.";
  if (code === "not_configured") return "The MLS connection is not configured. Saved entries are kept; an administrator needs to connect the MLS.";
  if (status === 401) return "Sign in again before using this property list.";
  if (status === 403 || code === "forbidden" || code === "sample_read_only") return "You do not have permission to use this property list.";
  if (status === 404 || code === "not_found") return "This property list or saved property is no longer available. Refresh the list before continuing.";
  if (operation === "add") return "Adding the property did not return a result. Your preview is kept. Refresh the list or retry; the same listing will not be added twice.";
  if (operation === "remove") return "The removal did not return a result. Refresh the list or retry to confirm its current state.";
  return operation === "lookup" ? "The MLS could not be reached. Your MLS number is kept. Try again." : "The property list could not be refreshed. Saved entries are kept. Try again.";
}

/** Shared factual read view for the lookup preview and saved-list entries. */
export function ContactPropertyListing({ listing, headingId }: { listing: Listing; headingId?: string }) {
  const pill = LISTING_STATUS_PILL[listing.status] ?? { tone: "neutral" as const, label: listing.status };
  const sold = listing.status === "closed" && Boolean(listing.closedPrice);
  const price = sold ? listing.closedPrice! : listing.listPrice;
  return <div className="min-w-0">
    <div className="relative overflow-hidden rounded-lg border border-border bg-tint"><ListingImage src={listing.photos[0]} source={listing.source} alt={listing.address} className="aspect-[16/9] w-full" /><StatusPill tone={pill.tone} className="absolute left-2.5 top-2.5 shadow-sm">{pill.label}</StatusPill></div>
    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-[11px] text-muted-foreground">{sold ? "Sold price" : "List price"}</p><p className="mt-1 break-words text-xl font-semibold tracking-tight tabular">{price > 0 ? formatCurrency(price) : "Price not provided"}</p></div><p className="text-[11px] font-semibold text-muted-foreground">{listing.source === "sample" ? "Sample property" : "MLS listing"}</p></div>
    <h4 id={headingId} tabIndex={headingId ? -1 : undefined} className="mt-2 break-words text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{listing.address}</h4>
    <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{[listing.city, listing.zip].filter(Boolean).join(" · ")}</p>
    {listing.addressWithheld && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The listing broker does not permit this address to be displayed.</p>}
    <p className="mt-2 text-xs leading-relaxed tabular">{specLine(listing)}</p>
    <p className="mt-1 break-words text-xs text-muted-foreground">MLS {listing.mlsNumber}</p>
    {listing.source === "mls" && <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{listing.listingOffice?.name ? `Listing courtesy of ${listing.listingOffice.name}` : "Listing office not provided by the MLS."}</p>}
  </div>;
}

export function SavedContactProperty({ property, canWrite, confirming, saving, prefix, onAskRemove, onCancelRemove, onRemove, onEditReview, onTransfer, onReadReview, onPlanShowing }: {
  property: PropertyView; canWrite: boolean; confirming: boolean; saving: boolean; prefix: string;
  onAskRemove: () => void; onCancelRemove: () => void; onRemove: () => void;
  onEditReview?: () => void; onTransfer?: () => void; onReadReview?: () => void; onPlanShowing?: () => void;
}) {
  const headingId = `${prefix}-property-${property.id}`;
  const menuNavigation = useRef(false), hasResearchActions = Boolean(onEditReview || onTransfer || onPlanShowing);
  const syncCopy = property.syncStatus === "not_found" ? "The MLS did not return details for this saved listing. The entry remains on this list."
    : property.syncStatus === "not_configured" ? "The MLS connection is not configured. This saved entry is kept."
      : "The MLS could not be refreshed. This saved entry is kept.";
  return <article className="flex min-w-0 flex-col rounded-card border border-border bg-card p-3 shadow-card" data-testid="contact-property">
    {property.listing ? <ContactPropertyListing listing={property.listing} headingId={headingId} /> : <div className="rounded-lg border border-dashed border-input bg-tint p-4"><h4 id={headingId} tabIndex={-1} className="break-words text-sm font-semibold [overflow-wrap:anywhere]">MLS {property.mlsNumber}</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{syncCopy}</p></div>}
    {property.checkedAt && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Checked <time dateTime={property.checkedAt}>{checkedStamp.format(new Date(property.checkedAt))}</time></p>}
    <div className="my-3 space-y-2 rounded-lg bg-tint p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">Your review</p><StatusPill tone="neutral">{REVIEW_LABELS[property.reviewStatus ?? "to_review"]}</StatusPill></div>{property.notes ? <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{property.notes}</p> : <p className="text-xs leading-relaxed text-muted-foreground">No private note.</p>}</div>
    <div className="mt-auto flex flex-wrap items-start justify-between gap-2 border-t border-border pt-3">
      {property.listing && <Button asChild size="sm" variant="outline"><Link href={`/listings/${encodeURIComponent(property.listing.id)}`}>View listing</Link></Button>}
      {!canWrite && onReadReview && <Button id={`${headingId}-actions`} type="button" size="sm" variant="ghost" onClick={onReadReview}>Read review</Button>}
      {canWrite && (confirming ? <div role="group" aria-label={`Remove MLS ${property.mlsNumber} from this list`} className="basis-full space-y-2"><p className="text-xs leading-relaxed text-muted-foreground">Remove this property from this list? Its private note and review will leave this list with it.</p><div className="flex flex-wrap gap-2"><Button id={`${headingId}-confirm-remove`} type="button" size="sm" disabled={saving} onClick={onRemove}>Remove from list</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancelRemove}>Keep property</Button></div></div> : hasResearchActions ? <DropdownMenu><DropdownMenuTrigger asChild><Button id={`${headingId}-actions`} type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Actions for MLS ${property.mlsNumber}`}><MoreHorizontal aria-hidden="true" />Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (menuNavigation.current) { event.preventDefault(); menuNavigation.current = false; } }}>{onEditReview && <DropdownMenuItem className="min-h-10" onSelect={() => { menuNavigation.current = true; onEditReview(); }}><NotebookPen aria-hidden="true" />Edit review</DropdownMenuItem>}{onTransfer && <DropdownMenuItem className="min-h-10" onSelect={() => { menuNavigation.current = true; onTransfer(); }}><Copy aria-hidden="true" />Copy or move</DropdownMenuItem>}{onPlanShowing && <DropdownMenuItem className="min-h-10" onSelect={() => { menuNavigation.current = true; onPlanShowing(); }}><CalendarClock aria-hidden="true" />Plan showing</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem className="min-h-10" onSelect={() => { menuNavigation.current = true; onAskRemove(); }}><Trash2 aria-hidden="true" />Remove from list</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : <Button id={`${headingId}-remove`} type="button" size="sm" variant="ghost" disabled={saving} onClick={onAskRemove}>Remove from list</Button>)}
    </div>
  </article>;
}

/** Contacts launch the full workspace; no MLS or property-list reads happen here. */
export function ContactProperties({ contactId, canWrite, available }: ContactPropertiesProps) {
  const query = new URLSearchParams({ contactId });
  return <section className="min-w-0 rounded-panel border border-border p-4" aria-label="Property lists" data-testid="contact-properties">
    <div className="flex items-center gap-2.5"><IconWell icon={Building2} /><h3 className="text-[15px] font-semibold">Property lists</h3></div>
    <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">Keep properties in named lists and review them in the full workspace.</p>
    {available ? <div className="mt-3 flex flex-wrap gap-2">{canWrite && <Button asChild size="sm"><Link href={`/property-lists?${query}&new=1`}>New list</Link></Button>}<Button asChild size="sm" variant="outline"><Link href={`/property-lists?${query}`}>View lists</Link></Button><Button asChild size="sm" variant="ghost"><Link href={`/showings?${new URLSearchParams({ contact: contactId })}`}>Showing agenda</Link></Button></div> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Property lists are not available with sample contact data.</p>}
  </section>;
}
