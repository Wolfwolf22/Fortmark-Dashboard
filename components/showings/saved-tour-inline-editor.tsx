"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@/lib/data/hooks";
import { getSavedShowingTour, updateSavedShowingTour } from "@/lib/data/adapters/saved-showing-tours";
import type { SavedShowingTourView, UpdateSavedShowingTourInput } from "@/lib/showings/saved-tour-domain";
import { SavedTourEditor } from "./saved-tour-editor";
import { SavedTourPlanDetails } from "./saved-tour-review";
import { savedTourAttempt, savedTourDraft, savedTourDraftSettings, savedTourFailure, savedTourVersionChanged, type SavedTourDraft, type SavedTourAttempt } from "./saved-tour-state";

export function savedTourInlineAttempt(previous: SavedTourAttempt<Omit<UpdateSavedShowingTourInput, "requestId">> | null, draft: SavedTourDraft, opening: SavedShowingTourView, uncertain: boolean, makeId?: () => string) {
  if (uncertain && previous) return { ok: true as const, attempt: previous };
  const checked = savedTourDraftSettings(draft, opening.startsAt);
  return checked.ok ? { ok: true as const, attempt: savedTourAttempt(previous, { ...checked.settings, expectedUpdatedAt: opening.updatedAt }, makeId) } : checked;
}

/** Calendar and full-page callers edit the same persisted plan, without routing away from their workspace. */
export function SavedTourInlineEditor({ id, onClose, onSaved, canWrite }: { id: string | null; onClose: () => void; onSaved: (tour: SavedShowingTourView) => void; canWrite: boolean }) {
  const [target, setTarget] = useState(id), [opening, setOpening] = useState<SavedShowingTourView | null>(null), [draft, setDraft] = useState<SavedTourDraft | null>(null), [fresh, setFresh] = useState<SavedShowingTourView | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<unknown>(null), [quarantined, setQuarantined] = useState(false);
  const attempt = useRef<SavedTourAttempt<Omit<UpdateSavedShowingTourInput, "requestId">> | null>(null), alert = useRef<HTMLParagraphElement>(null), freshRef = useRef<HTMLDivElement>(null);
  const query = useQuery(() => target ? getSavedShowingTour(target) : Promise.resolve(null), [target]);
  useEffect(() => { if (id && id !== target && !uncertain && !busy) { setTarget(id); setOpening(null); setDraft(null); setQuarantined(false); setFresh(null); setConflict(false); setError(null); attempt.current = null; } }, [id, target, uncertain, busy]);
  useEffect(() => { if (!opening && query.data?.id === target) { setOpening(query.data); setDraft(savedTourDraft(query.data)); } }, [opening, query.data, target]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (fresh) freshRef.current?.focus(); }, [fresh]);
  const authLost = [query.error, error].some(failure => [401,403,404].includes((failure as {status?:number})?.status ?? 0));
  useEffect(() => { if (authLost) setQuarantined(true); }, [authLost]);
  const denied = quarantined || authLost, changed = conflict || Boolean(opening && query.data && savedTourVersionChanged(opening, query.data)), writable = Boolean(canWrite && opening?.canEdit && query.data?.canEdit && !denied && !query.error), dirty = Boolean(opening && draft && JSON.stringify(draft) !== JSON.stringify(savedTourDraft(opening)));
  async function reload() { if (!target || busy) return; setLoading(true); setError(null); try { const value = await getSavedShowingTour(target); if (value.id !== target) throw Error("Saved plan unavailable"); setFresh(value); setQuarantined(false); query.refetch(); } catch (failure) { setError(failure); if ([401,403,404].includes((failure as {status?:number})?.status ?? 0)) setQuarantined(true); } finally { setLoading(false); } }
  function accept(keep: boolean) { if (!fresh) return; setOpening(fresh); if (!keep) setDraft(savedTourDraft(fresh)); setFresh(null); setConflict(false); setUncertain(false); setError(null); attempt.current = null; }
  async function save(retry = false) {
    if (!target || !opening || !draft || busy || loading || !canWrite || denied || !retry && (!writable || changed || fresh || uncertain)) return;
    if (retry && (!uncertain || !attempt.current)) return;
    const checked = savedTourInlineAttempt(attempt.current, draft, opening, uncertain); if (!checked.ok) { setError(Error(checked.message)); return; } attempt.current = checked.attempt; const input: UpdateSavedShowingTourInput = attempt.current.input;
    setBusy(true); setError(null);
    try { const saved = await updateSavedShowingTour(target, input); if (saved.id !== target) throw Error("Save not confirmed"); setOpening(saved); setDraft(savedTourDraft(saved)); setUncertain(false); attempt.current = null; onSaved(saved); onClose(); }
    catch (failure) { setError(failure); const status = (failure as { status?: number })?.status; if (!status || status >= 500) setUncertain(true); else if (status === 409) setConflict(true); } finally { setBusy(false); }
  }
  return <Dialog open={Boolean(id)} onOpenChange={open => !open && !busy && onClose()}><DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b border-border p-5 pr-12"><DialogTitle>Tour settings & private notes</DialogTitle><DialogDescription>{denied ? "This plan is no longer available." : opening?.name || "Loading the saved plan…"}</DialogDescription></DialogHeader><div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5">{Boolean(error) && <p ref={alert} tabIndex={-1} role="alert" className="text-sm leading-relaxed">{error instanceof Error && !('status' in error) && !uncertain ? error.message : savedTourFailure(error)}</p>}{query.error && <p role="alert" className="text-sm">{savedTourFailure(query.error)}</p>}{!denied && opening && draft ? <>{uncertain && <p role="status" className="rounded-panel border border-input p-3 text-sm">A save may already have succeeded. Your original settings and request are kept. Check that same save result before making another change.</p>}{changed && !fresh && <p className="text-sm">The saved plan changed. Your settings draft is preserved. Review its current version before saving.</p>}{fresh && <div ref={freshRef} tabIndex={-1} className="space-y-3 rounded-panel border border-input p-4"><h3 className="text-sm font-semibold">Current saved plan</h3><SavedTourPlanDetails tour={fresh}/><div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => accept(true)}>Keep my full draft</Button><Button type="button" size="sm" variant="outline" onClick={() => accept(false)}>Use saved settings</Button></div></div>}{writable ? <SavedTourEditor draft={draft} onChange={setDraft} opening={opening} disabled={busy || loading || changed || Boolean(fresh) || uncertain}/> : <SavedTourPlanDetails tour={opening}/>}<p className="text-xs leading-relaxed text-muted-foreground">Saving changes the private tour plan. Booked showings change only after a separate schedule review and confirmation.</p></> : !denied && !query.error ? <p role="status" className="text-sm">Loading your saved tour…</p> : null}</div><div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card p-4"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Close</Button><div className="flex flex-wrap gap-2">{<Button type="button" variant="outline" disabled={busy || loading} onClick={() => void reload()}>{denied ? "Retry access" : "Review current saved plan"}</Button>}{canWrite && !denied && (uncertain ? <Button type="button" disabled={busy || loading} onClick={() => void save(true)}>Check same save result</Button> : <Button type="button" disabled={busy || loading || !writable || changed || Boolean(fresh) || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button>)}</div></div></DialogContent></Dialog>;
}
