"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import { ListingImage } from "@/components/listings/listing-image";
import { specLine } from "@/components/listings/listing-meta";
import { addContactProperty, getContactProperties, lookupContactProperty, removeContactProperty } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import type { Listing } from "@/lib/data/types";
import { normalizePropertyMlsNumber, PROPERTY_MLS_NUMBER_MAX, type AddPropertyInput, type PropertyLookup, type PropertyPage, type PropertyView } from "@/lib/contacts/properties";
import { BUSINESS_TIME_ZONE } from "@/lib/metrics/business-day";
import { formatCurrency } from "@/lib/utils";

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
  if (status === 401) return "Sign in again before using this contact's property list.";
  if (status === 403 || code === "forbidden" || code === "sample_read_only") return "You do not have permission to use this contact's property list.";
  if (status === 404 || code === "not_found") return "This contact or saved property is no longer available. Refresh the list before continuing.";
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

export function SavedContactProperty({ property, canWrite, confirming, saving, prefix, onAskRemove, onCancelRemove, onRemove }: {
  property: PropertyView; canWrite: boolean; confirming: boolean; saving: boolean; prefix: string;
  onAskRemove: () => void; onCancelRemove: () => void; onRemove: () => void;
}) {
  const headingId = `${prefix}-property-${property.id}`;
  const syncCopy = property.syncStatus === "not_found" ? "The MLS did not return details for this saved listing. The entry remains on this list."
    : property.syncStatus === "not_configured" ? "The MLS connection is not configured. This saved entry is kept."
      : "The MLS could not be refreshed. This saved entry is kept.";
  return <article className="min-w-0 rounded-panel border border-border bg-card p-3" data-testid="contact-property">
    {property.listing ? <ContactPropertyListing listing={property.listing} headingId={headingId} /> : <div className="rounded-lg border border-dashed border-input bg-tint p-4"><h4 id={headingId} tabIndex={-1} className="break-words text-sm font-semibold [overflow-wrap:anywhere]">MLS {property.mlsNumber}</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{syncCopy}</p></div>}
    {property.checkedAt && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Checked <time dateTime={property.checkedAt}>{checkedStamp.format(new Date(property.checkedAt))}</time></p>}
    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      {property.listing && <Button asChild size="sm" variant="outline"><Link href={`/listings/${encodeURIComponent(property.listing.id)}`}>View listing</Link></Button>}
      {canWrite && (confirming ? <div role="group" aria-label={`Remove MLS ${property.mlsNumber} from this list`} className="space-y-2"><p className="text-xs leading-relaxed text-muted-foreground">Remove this property from this contact&apos;s list?</p><div className="flex flex-wrap gap-2"><Button id={`${headingId}-confirm-remove`} type="button" size="sm" disabled={saving} onClick={onRemove}>Remove from list</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancelRemove}>Keep property</Button></div></div> : <Button id={`${headingId}-remove`} type="button" size="sm" variant="ghost" disabled={saving} onClick={onAskRemove}>Remove from list</Button>)}
    </div>
  </article>;
}

export function ContactProperties(props: ContactPropertiesProps) { return <PropertyWorkspace key={props.contactId} {...props} />; }
function PropertyWorkspace({ contactId, canWrite, available, refreshKey = 0 }: ContactPropertiesProps) {
  const prefix = useId();
  const [page, setPage] = useState(1);
  const list = useQuery<ContactPropertyPageAnswer | null>(async () => available ? { requestPage: page, result: await getContactProperties(contactId, page) } : null, [contactId, page, available, refreshKey]);
  const data = list.data?.result;
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ContactPropertyPreview | null>(null);
  const [finding, setFinding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [focusSaved, setFocusSaved] = useState<{ id: string; after: ContactPropertyPageAnswer | null | undefined } | null>(null);
  const sequence = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const saving = savingId !== null;
  const currentPreview = propertyPreviewMatchesInput(preview, query) ? preview : null;
  const alreadySaved = Boolean(currentPreview && (currentPreview.result.alreadySaved || data?.items.some((item) => item.listingId === currentPreview.result.listing.id)));
  const currentPage = list.data?.requestPage === page && data?.page === page ? data : null;
  const maxPage = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize || 12)));
  const recoverPage = contactPropertyPageRecovery(page, list.data, !list.loading && !list.error);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (recoverPage !== null) setPage(recoverPage);
  }, [recoverPage]);
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "heading") heading.current?.focus(); else document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget, confirmRemove, currentPreview]);
  useEffect(() => {
    if (!focusSaved || list.loading || !currentPage || list.data === focusSaved.after) return;
    const target = currentPage.items.some((item) => item.id === focusSaved.id) ? document.getElementById(`${prefix}-property-${focusSaved.id}`) : document.getElementById(`${prefix}-preview-heading`);
    (target ?? heading.current)?.focus(); setFocusSaved(null);
  }, [focusSaved, currentPage, list.data, list.loading, prefix]);
  function changeQuery(value: string) {
    sequence.current++; setQuery(value); setPreview(null); setFinding(false); setLookupError(null); setFailure(null); setNotice(null);
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    if (saving || !canWrite || !available) return;
    const mlsNumber = normalizePropertyMlsNumber(query);
    if (!mlsNumber) { setLookupError(contactPropertyFailure({ code: "invalid_property" }, "lookup")); input.current?.focus(); return; }
    const request = ++sequence.current;
    setFinding(true); setPreview(null); setLookupError(null); setFailure(null); setNotice(null);
    try {
      const result = await lookupContactProperty(contactId, mlsNumber);
      if (request !== sequence.current) return;
      setPreview({ query: mlsNumber, result }); setFocusTarget(`${prefix}-preview-heading`);
    } catch (error) {
      if (request !== sequence.current) return;
      setLookupError(contactPropertyFailure(error, "lookup")); input.current?.focus();
    } finally { if (request === sequence.current) setFinding(false); }
  }
  async function add() {
    if (!currentPreview || alreadySaved || saving || !canWrite || !available) return;
    const frozen = currentPreview;
    setSavingId("add"); setFailure(null); setNotice(null);
    try {
      const property = await addContactProperty(contactId, reviewedContactPropertyAddInput(frozen));
      const confirmed = confirmedPropertyAddState(property, contactId, frozen);
      if (!confirmed) throw new Error("The saved listing reference was not confirmed");
      sequence.current++; setQuery(confirmed.query); setPreview(confirmed.preview); setLookupError(null);
      setPage(1); list.refetch(); setFocusTarget("heading"); setFocusSaved({ id: confirmed.propertyId, after: list.data }); setNotice("Property saved to this contact's list.");
    } catch (error) {
      setFailure(contactPropertyFailure(error, "add")); list.refetch(); setFocusTarget(`${prefix}-preview-heading`);
      if (error && typeof error === "object" && "code" in error && (error.code === "listing_changed" || error.code === "ambiguous" || error.code === "listing_not_found")) { setPreview(null); setFocusTarget(`${prefix}-mls`); }
    } finally { setSavingId(null); }
  }
  async function remove(property: PropertyView) {
    if (saving || !canWrite || !available) return;
    setSavingId(property.id); setFailure(null); setNotice(null);
    try {
      const result = await removeContactProperty(contactId, property.id);
      if (!result.removed) throw new Error("Removal not confirmed");
      setConfirmRemove(null); setNotice(`MLS ${property.mlsNumber} removed from this contact's list.`); list.refetch(); setFocusTarget("heading");
      if (currentPreview?.result.listing.id === property.listingId) setPreview({ ...currentPreview, result: { ...currentPreview.result, alreadySaved: false } });
    } catch (error) { setFailure(contactPropertyFailure(error, "remove")); list.refetch(); }
    finally { setSavingId(null); }
  }
  return <section className="min-w-0" aria-labelledby={`${prefix}-heading`} data-testid="contact-properties">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2.5"><IconWell icon={Building2} /><div><h3 ref={heading} id={`${prefix}-heading`} tabIndex={-1} className="text-[15px] font-semibold">Property list</h3>{data && <p className="mt-1 text-xs text-muted-foreground tabular">{data.total} {data.total === 1 ? "property" : "properties"}</p>}</div></div>{available && <Button type="button" size="sm" variant="outline" disabled={list.loading || saving} onClick={list.refetch}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{list.loading && data ? "Refreshing…" : "Refresh from MLS"}</Button>}</div>
    {!available ? <p className="mt-3 rounded-panel border border-border bg-tint p-4 text-[13px] leading-relaxed text-muted-foreground">Property lists are not available with sample contact data.</p> : <>
      {canWrite && <form onSubmit={(event) => void find(event)} className="mt-4 space-y-3 rounded-panel border border-border bg-tint p-3"><div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-mls`}>Add by MLS number</Label><Input ref={input} id={`${prefix}-mls`} value={query} onChange={(event) => changeQuery(event.target.value)} maxLength={PROPERTY_MLS_NUMBER_MAX} spellCheck={false} autoCapitalize="characters" autoCorrect="off" disabled={saving} className="h-10" aria-invalid={Boolean(lookupError)} aria-describedby={lookupError ? `${prefix}-lookup-error` : `${prefix}-help`} /></div><p id={`${prefix}-help`} className="text-xs leading-relaxed text-muted-foreground">Find the exact MLS number, review the property, then add it to this contact&apos;s list.</p>{lookupError && <p id={`${prefix}-lookup-error`} role="alert" className="text-xs leading-relaxed text-destructive">{lookupError}</p>}<div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={finding || saving || !query.trim()}>{finding ? "Finding property…" : "Find property"}</Button>{query && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { changeQuery(""); input.current?.focus(); }}>Clear search</Button>}</div></form>}
      {currentPreview && <div className="mt-3 space-y-3 rounded-panel border border-input bg-card p-3"><h4 id={`${prefix}-preview-heading`} tabIndex={-1} className="text-sm font-semibold">Property found</h4><ContactPropertyListing listing={currentPreview.result.listing} />{alreadySaved ? <p role="status" className="text-xs font-medium leading-relaxed">Already on this contact&apos;s property list.</p> : <Button type="button" size="sm" disabled={saving} onClick={() => void add()}>{savingId === "add" ? "Adding property…" : "Add to list"}</Button>}</div>}
      {failure && <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">{failure}</p>}
      {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">{notice}</p>}
      {!data && list.loading ? <div className="mt-4 space-y-3" aria-label="Loading saved properties">{[1, 2].map((item) => <Skeleton key={item} className="h-44 w-full rounded-panel" />)}</div> : list.error && !currentPage ? <div role="alert" className="mt-4 rounded-panel border border-border bg-tint p-4"><p className="text-sm leading-relaxed">{contactPropertyFailure(list.error, "read")}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={list.refetch}>Try again</Button></div> : currentPage && currentPage.total === 0 ? <p className="mt-4 rounded-panel border border-dashed border-input p-4 text-[13px] leading-relaxed text-muted-foreground">{canWrite ? "No properties saved. Find a property by MLS number to add it here." : "No properties saved for this contact."}</p> : currentPage ? <div className="mt-4 space-y-3">{currentPage.items.map((property) => <SavedContactProperty key={property.id} property={property} canWrite={canWrite} saving={saving} confirming={confirmRemove === property.id} prefix={prefix} onAskRemove={() => { setConfirmRemove(property.id); setFocusTarget(`${prefix}-property-${property.id}-confirm-remove`); }} onCancelRemove={() => { setConfirmRemove(null); setFocusTarget(`${prefix}-property-${property.id}-remove`); }} onRemove={() => void remove(property)} />)}</div> : <Skeleton className="mt-4 h-44 w-full rounded-panel" />}
      {list.error && currentPage && <p role="alert" className="mt-3 text-xs leading-relaxed text-muted-foreground">The latest property list could not be refreshed. Your loaded entries are kept. <button type="button" className="min-h-10 rounded-md px-1 font-semibold underline underline-offset-4" onClick={list.refetch}>Try again</button></p>}
      {data && data.total > data.pageSize && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-muted-foreground tabular">Page {Math.min(page, maxPage)} of {maxPage} · {data.total} properties</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={list.loading || saving || page <= 1} onClick={() => { setPage((current) => current - 1); setFocusTarget("heading"); }}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={list.loading || saving || page >= maxPage} onClick={() => { setPage((current) => current + 1); setFocusTarget("heading"); }}>Next</Button></div></div>}
    </>}
  </section>;
}
