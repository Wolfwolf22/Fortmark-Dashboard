"use client";

/**
 * Client needs — what a person is trying to accomplish, as structured fields.
 *
 * A compact summary of what is actually stored (a need with no budget shows no
 * budget line), and an inline form that keeps the common fields up front and puts
 * the rest behind "More requirements". A person may have several needs at once;
 * the screen leads with the active ones. Needs are paused, fulfilled or archived —
 * never deleted — so the relationship keeps its history.
 *
 * This is not an opportunity or a deal forecast. It is what the client asked for,
 * stored so that a later search can use it without reading a paragraph.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { IconWell } from "@/components/ui/icon-well";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createNeed, getNeedsPage, LeadsError, updateNeed, type NeedView } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import {
  NEED_FINANCING,
  NEED_FINANCING_LABELS,
  NEED_KINDS,
  NEED_KIND_LABELS,
  NEED_LIMITS,
  NEED_PROPERTY_TYPES,
  NEED_PROPERTY_TYPE_LABELS,
  type CreateNeedInput,
  type NeedFinancing,
  type NeedKind,
  type NeedPropertyType,
  type NeedStatus,
} from "@/lib/contacts/needs";
import { TagInput } from "./tag-input";
import { NeedSummary } from "./need-summary";
import type { HistoryPage } from "@/lib/contacts/history";

const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));
const toCents = (text: string): number | null => {
  const t = text.trim().replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const toInt = (text: string): number | null | typeof NaN => {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

interface FormState {
  kind: NeedKind;
  areas: string[];
  propertyTypes: NeedPropertyType[];
  priceMin: string;
  priceMax: string;
  minBeds: string;
  minBaths: string;
  targetDate: string;
  timelineNote: string;
  minSqft: string;
  financing: NeedFinancing | "";
  mustHaves: string[];
  avoid: string[];
  additional: string;
}

function blank(): FormState {
  return { kind: "buy", areas: [], propertyTypes: [], priceMin: "", priceMax: "", minBeds: "", minBaths: "", targetDate: "", timelineNote: "", minSqft: "", financing: "", mustHaves: [], avoid: [], additional: "" };
}

function fromNeed(n: NeedView): FormState {
  return {
    kind: n.kind,
    areas: n.areas,
    propertyTypes: n.propertyTypes,
    priceMin: dollars(n.priceMinCents),
    priceMax: dollars(n.priceMaxCents),
    minBeds: n.minBeds == null ? "" : String(n.minBeds),
    minBaths: n.minBaths == null ? "" : String(n.minBaths),
    targetDate: n.targetDate ?? "",
    timelineNote: n.timelineNote ?? "",
    minSqft: n.minSqft == null ? "" : String(n.minSqft),
    financing: n.financing ?? "",
    mustHaves: n.mustHaves,
    avoid: n.avoid,
    additional: n.additionalRequirements ?? "",
  };
}

/** The request for a form, or the field that cannot be sent. */
function toRequest(s: FormState): { ok: true; body: CreateNeedInput } | { ok: false; field: string; message: string } {
  const min = toCents(s.priceMin);
  const max = toCents(s.priceMax);
  if (Number.isNaN(min)) return { ok: false, field: "need-price-min", message: "Enter the minimum budget as a number." };
  if (Number.isNaN(max)) return { ok: false, field: "need-price-max", message: "Enter the maximum budget as a number." };
  if (min != null && max != null && max < min) return { ok: false, field: "need-price-max", message: "The maximum budget is below the minimum." };
  const beds = toInt(s.minBeds);
  if (Number.isNaN(beds) || (beds != null && !Number.isInteger(beds))) return { ok: false, field: "need-beds", message: "Beds must be a whole number." };
  const baths = toInt(s.minBaths);
  if (Number.isNaN(baths) || (baths != null && !Number.isInteger((baths as number) * 2))) return { ok: false, field: "need-baths", message: "Baths can be whole or half, like 2 or 2.5." };
  const sqft = toInt(s.minSqft);
  if (Number.isNaN(sqft) || (sqft != null && !Number.isInteger(sqft))) return { ok: false, field: "need-sqft", message: "Square feet must be a whole number." };
  return {
    ok: true,
    body: {
      kind: s.kind,
      areas: s.areas,
      propertyTypes: s.propertyTypes,
      priceMinCents: min,
      priceMaxCents: max,
      minBeds: beds as number | null,
      minBaths: baths as number | null,
      minSqft: sqft as number | null,
      targetDate: s.targetDate || null,
      timelineNote: s.timelineNote.trim() || null,
      financing: s.financing || null,
      mustHaves: s.mustHaves,
      avoid: s.avoid,
      additionalRequirements: s.additional.trim() || null,
    },
  };
}

function NeedForm({
  initial,
  saving,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: FormState;
  saving: boolean;
  onSubmit: (body: CreateNeedInput) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [s, setS] = useState(initial);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((v) => ({ ...v, [key]: value }));

  useEffect(() => {
    if (error) document.getElementById(error.field)?.focus();
  }, [error]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const req = toRequest(s);
    if (!req.ok) {
      setError({ field: req.field, message: req.message });
      return;
    }
    setError(null);
    onSubmit(req.body);
  }

  const invalid = (id: string) => (error?.field === id ? true : undefined);

  return (
    <form onSubmit={submit} className="mt-3 grid min-w-0 gap-4 rounded-panel border border-border bg-tint p-4" aria-label="Client need">
      <div className="grid gap-1.5">
        <Label htmlFor="need-kind">Need type</Label>
        <Select value={s.kind} onValueChange={(v) => set("kind", v as NeedKind)} disabled={saving}>
          <SelectTrigger id="need-kind" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NEED_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {NEED_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TagInput id="need-areas" label="Areas" values={s.areas} onChange={(v) => set("areas", v)} max={NEED_LIMITS.areas} itemMax={NEED_LIMITS.itemLength} placeholder="City or neighborhood" disabled={saving} />

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium leading-none">Property type</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
          {NEED_PROPERTY_TYPES.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <Checkbox
                id={`need-type-${t}`}
                checked={s.propertyTypes.includes(t)}
                disabled={saving}
                onCheckedChange={(v) => set("propertyTypes", v === true ? [...s.propertyTypes, t] : s.propertyTypes.filter((x) => x !== t))}
              />
              <Label htmlFor={`need-type-${t}`} className="font-normal">
                {NEED_PROPERTY_TYPE_LABELS[t]}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="need-price-min">Budget minimum ($)</Label>
          <Input id="need-price-min" inputMode="decimal" value={s.priceMin} onChange={(e) => set("priceMin", e.target.value)} disabled={saving} aria-invalid={invalid("need-price-min")} placeholder="600000" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="need-price-max">Budget maximum ($)</Label>
          <Input id="need-price-max" inputMode="decimal" value={s.priceMax} onChange={(e) => set("priceMax", e.target.value)} disabled={saving} aria-invalid={invalid("need-price-max")} placeholder="750000" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="need-beds">Minimum beds</Label>
          <Input id="need-beds" inputMode="numeric" value={s.minBeds} onChange={(e) => set("minBeds", e.target.value)} disabled={saving} aria-invalid={invalid("need-beds")} placeholder="3" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="need-baths">Minimum baths</Label>
          <Input id="need-baths" inputMode="decimal" value={s.minBaths} onChange={(e) => set("minBaths", e.target.value)} disabled={saving} aria-invalid={invalid("need-baths")} placeholder="2.5" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="need-target-date">Target date</Label>
          <Input id="need-target-date" type="date" value={s.targetDate} onChange={(e) => set("targetDate", e.target.value)} disabled={saving} className="min-w-0" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="need-timeline-note">Timeline note</Label>
          <Input id="need-timeline-note" value={s.timelineNote} onChange={(e) => set("timelineNote", e.target.value)} maxLength={NEED_LIMITS.timelineNote} disabled={saving} placeholder="After lease ends" />
        </div>
      </div>

      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2" aria-expanded={more} aria-controls="need-more" onClick={() => setMore((m) => !m)}>
          {more ? "Fewer requirements" : "More requirements"}
        </Button>
        {more && (
          <div id="need-more" className="mt-2 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="need-sqft">Minimum square feet</Label>
                <Input id="need-sqft" inputMode="numeric" value={s.minSqft} onChange={(e) => set("minSqft", e.target.value)} disabled={saving} aria-invalid={invalid("need-sqft")} placeholder="1800" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="need-financing">Financing</Label>
                <Select value={s.financing || "none"} onValueChange={(v) => set("financing", v === "none" ? "" : (v as NeedFinancing))} disabled={saving}>
                  <SelectTrigger id="need-financing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not asked</SelectItem>
                    {NEED_FINANCING.map((f) => (
                      <SelectItem key={f} value={f}>
                        {NEED_FINANCING_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <TagInput id="need-must-haves" label="Must-haves" values={s.mustHaves} onChange={(v) => set("mustHaves", v)} max={NEED_LIMITS.mustHaves} itemMax={NEED_LIMITS.itemLength} placeholder="Pool, garage…" disabled={saving} />
            <TagInput id="need-avoid" label="Avoid" values={s.avoid} onChange={(v) => set("avoid", v)} max={NEED_LIMITS.avoid} itemMax={NEED_LIMITS.itemLength} placeholder="Busy street, HOA…" disabled={saving} />
            <div className="grid gap-1.5">
              <Label htmlFor="need-additional">Additional requirements</Label>
              <Textarea id="need-additional" rows={3} value={s.additional} onChange={(e) => set("additional", e.target.value)} maxLength={NEED_LIMITS.additional} disabled={saving} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function LeadNeeds({ leadId, canWrite, available, refreshKey = 0 }: { leadId: string; canWrite: boolean; available: boolean; refreshKey?: number }) {
  const { data, loading, error, refetch } = useQuery<HistoryPage<NeedView>>(() => getNeedsPage(leadId), [leadId, refreshKey]);
  const [older, setOlder] = useState<{ head: HistoryPage<NeedView>; items: NeedView[]; hasMore: boolean; nextCursor: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pageProblem, setPageProblem] = useState<string | null>(null);
  const pageRequest = useRef(0);
  const [mode, setMode] = useState<{ kind: "add" } | { kind: "edit"; need: NeedView } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  // A successful write/refetch restarts the ordered stream. A moved status can
  // change page position, so stale older pages must not stay attached to it.
  useEffect(() => {
    pageRequest.current++;
    setOlder(null);
    setLoadingOlder(false);
    setPageProblem(null);
    return () => { pageRequest.current++; };
  }, [data, leadId, refreshKey]);

  const [forLead, setForLead] = useState(leadId);
  if (forLead !== leadId) {
    setForLead(leadId);
    setMode(null);
    setMessage(null);
    setProblem(null);
    setShowOthers(false);
  }

  async function run(work: () => Promise<unknown>, done: string) {
    setSaving(true);
    setProblem(null);
    setMessage(null);
    try {
      await work();
      setMode(null);
      setMessage(done);
      refetch();
    } catch (e) {
      setProblem(
        e instanceof LeadsError && e.status === 403
          ? "You do not have permission to change this contact's needs."
          : e instanceof LeadsError && e.status === 400
            ? "That need could not be saved. Check the fields."
            : "The change could not be saved. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const currentOlder = older?.head === data ? older : null;
  const needs = [...(data?.items ?? []), ...(currentOlder?.items ?? [])];
  const hasMore = currentOlder ? currentOlder.hasMore : data?.hasMore ?? false;
  const nextCursor = currentOlder ? currentOlder.nextCursor : data?.nextCursor;
  async function loadOlder() {
    if (!data || !nextCursor || loading || loadingOlder || saving) return;
    const head = data;
    const request = ++pageRequest.current;
    setLoadingOlder(true);
    setPageProblem(null);
    try {
      const page = await getNeedsPage(leadId, nextCursor);
      if (request !== pageRequest.current) return;
      setOlder((previous) => {
        const existing = previous?.head === head ? previous.items : [];
        const seen = new Set([...head.items, ...existing].map((need) => need.id));
        return { head, items: [...existing, ...page.items.filter((need) => !seen.has(need.id))], hasMore: page.hasMore, nextCursor: page.nextCursor };
      });
    } catch {
      if (request === pageRequest.current) setPageProblem("More needs could not be loaded. Try again.");
    } finally {
      if (request === pageRequest.current) setLoadingOlder(false);
    }
  }
  const active = needs.filter((n) => n.status === "active");
  const others = needs.filter((n) => n.status !== "active");
  const setStatus = (n: NeedView, status: NeedStatus, done: string) => void run(() => updateNeed(leadId, n.id, { status }), done);

  return (
    <section aria-labelledby="lead-needs-heading" data-testid="lead-needs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
        <IconWell icon={Target} />
        <h3 id="lead-needs-heading" className="text-[15px] font-semibold">
          Client needs
        </h3>
        </div>
        {available && canWrite && !mode && (
          <Button type="button" size="sm" variant="outline" onClick={() => { setProblem(null); setMessage(null); setMode({ kind: "add" }); }}>
            {needs.length === 0 ? "Add client need" : "Add another"}
          </Button>
        )}
      </div>

      {!available ? (
        <p className="mt-3 rounded-panel border border-border bg-tint p-4 text-[13px] leading-relaxed text-muted-foreground">Client needs are not available with sample data.</p>
      ) : !data && loading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : error && !data ? (
        <div role="alert" className="mt-3 rounded-panel border border-border bg-tint p-4 text-sm">
          <p>Client needs could not be loaded.</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={refetch}>Try again</Button>
        </div>
      ) : (
        <>
          {mode?.kind === "add" && (
            <NeedForm initial={blank()} saving={saving} submitLabel="Save need" onCancel={() => setMode(null)} onSubmit={(body) => void run(() => createNeed(leadId, body), "Client need added.")} />
          )}
          {mode?.kind === "edit" && (
            <NeedForm initial={fromNeed(mode.need)} saving={saving} submitLabel="Save changes" onCancel={() => setMode(null)} onSubmit={(body) => void run(() => updateNeed(leadId, mode.need.id, body), "Client need updated.")} />
          )}

          {!mode && needs.length === 0 && <p className="mt-3 rounded-panel border border-dashed border-input px-4 py-5 text-[13px] text-muted-foreground">No client needs added.</p>}

          {active.map((n) => (
            <div key={n.id} className={mode ? "hidden" : "mt-3 rounded-panel border border-border bg-tint p-4"}>
              <NeedSummary need={n} />
              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setMode({ kind: "edit", need: n })}>
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setStatus(n, "paused", "Client need paused.")}>
                    Pause
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setStatus(n, "fulfilled", "Client need marked fulfilled.")}>
                    Fulfilled
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setStatus(n, "archived", "Client need archived.")}>
                    Archive
                  </Button>
                </div>
              )}
            </div>
          ))}

          {others.length > 0 && !mode && (
            <div className="mt-3">
              <Button type="button" variant="ghost" size="sm" className="-ml-2" aria-expanded={showOthers} aria-controls="lead-other-needs" onClick={() => setShowOthers((v) => !v)}>
                {showOthers ? "Hide other needs" : `Other needs (${others.length})`}
              </Button>
              {showOthers && (
                <div id="lead-other-needs" className="mt-1 space-y-2">
                  {others.map((n) => (
                    <div key={n.id} className="rounded-panel border border-border p-4">
                      <NeedSummary need={n} />
                      {canWrite && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setStatus(n, "active", "Client need reactivated.")}>
                            Reactivate
                          </Button>
                          {n.status !== "archived" && (
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setStatus(n, "archived", "Client need archived.")}>
                              Archive
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!mode && (hasMore || currentOlder) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" className="aria-disabled:cursor-default aria-disabled:opacity-60" aria-disabled={loadingOlder || loading || saving || !hasMore} onClick={() => void loadOlder()}>
                {!hasMore ? "All needs loaded" : loadingOlder ? "Loading needs…" : "Load older needs"}
              </Button>
              <p className="text-xs text-muted-foreground">{needs.length} needs loaded</p>
            </div>
          )}
          {pageProblem && <p role="alert" className="mt-3 text-sm text-destructive">{pageProblem}</p>}
        </>
      )}
      {available && error && data && <p role="alert" className="mt-3 text-sm text-muted-foreground">Client needs could not be refreshed. <button type="button" className="min-h-10 rounded-md px-1 font-semibold underline underline-offset-4" onClick={refetch}>Try again</button></p>}

      {problem && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {problem}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  );
}
