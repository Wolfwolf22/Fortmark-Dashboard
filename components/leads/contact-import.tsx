"use client";

import { useId, useRef, useState } from "react";
import { Check, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IMPORT_FIELDS, IMPORT_LIMITS, mapImportRows, parseContactCsv, suggestImportMapping, type ImportField, type ImportPreview, type ImportRawRow, type ImportResult } from "@/lib/contacts/import";
import { canTransition } from "@/lib/contacts/stages";
import type { DuplicateContact } from "@/lib/contacts/duplicates";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, type LeadSource, type LeadStage } from "@/lib/data/types";

type PreviewRow = ImportPreview["rows"][number];
type RawValues = ImportRawRow["values"];
export type ImportDecision = "add" | "update" | "skip";
export interface ReviewedImportRow {
  rowNumber: number; values: RawValues; decision: ImportDecision; reviewFingerprint: string;
  createSeparate?: boolean; targetId?: string; expectedUpdatedAt?: string;
}
export interface ContactImportSubmission { requestId: string; engagementAcknowledged?: true; rows: ReviewedImportRow[] }
interface ContactImportProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  onPreview: (input: { rows: ImportRawRow[] }) => Promise<ImportPreview>;
  onCommit: (input: ContactImportSubmission) => Promise<ImportResult>;
  onDone?: () => void;
}
export interface ImportRowDraft { preview: PreviewRow; values: RawValues; decision: ImportDecision | null; targetId?: string; expectedUpdatedAt?: string; createSeparate: boolean }
const LABELS: Record<ImportField, string> = { firstName: "First name", lastName: "Last name", preferredName: "Preferred name", fullName: "Full name", email: "Email", phone: "Phone", company: "Company", source: "Source", stage: "Stage", about: "About", notes: "Note" };
const PAGE_SIZE = 10;
type ParsedCsv = Extract<ReturnType<typeof parseContactCsv>, { ok: true }>;
export interface ContactReviewRequest { fingerprint: string; requestId: string }
export function contactReviewRequest(previous: ContactReviewRequest | null, payload: unknown, makeId: () => string = () => crypto.randomUUID()): ContactReviewRequest {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
  const fingerprint = JSON.stringify(canonical(payload));
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: makeId() };
}

/** A fresh server preview never silently adopts a changed matched contact. */
export function importDraftsFromPreview(preview: ImportPreview, previous: readonly ImportRowDraft[] = []): ImportRowDraft[] {
  return preview.rows.map((row) => {
    const old = previous.find((draft) => draft.preview.rowNumber === row.rowNumber);
    const unchanged = old && JSON.stringify(old.values) === JSON.stringify(row.values);
    const candidate = old?.targetId ? row.candidates.find((match) => match.contact.id === old.targetId && match.contact.updatedAt === old.expectedUpdatedAt) : null;
    const preserve = unchanged && old && (old.decision !== "update" || candidate);
    return { preview: row, values: { ...row.values }, decision: preserve ? old.decision : row.candidates.length || row.fileDuplicates.length ? null : row.errors.length ? "skip" : row.recommendedDecision,
      ...(preserve && old.targetId ? { targetId: old.targetId, expectedUpdatedAt: old.expectedUpdatedAt } : {}), createSeparate: Boolean(preserve && old.createSeparate) };
  });
}
export function importRowReady(row: ImportRowDraft): boolean {
  if (!row.decision) return false;
  if (row.decision === "skip") return true;
  if (row.preview.errors.length) return false;
  if (row.decision === "update") return Boolean(row.targetId && row.expectedUpdatedAt && row.preview.candidates.some((candidate) => candidate.contact.id === row.targetId && candidate.contact.updatedAt === row.expectedUpdatedAt && (!row.preview.normalized.stage || row.preview.normalized.stage === candidate.contact.stage || canTransition(candidate.contact.stage, row.preview.normalized.stage))));
  if (!(row.preview.normalized.firstName || row.preview.normalized.lastName || row.preview.normalized.preferredName)) return false;
  return !importRowHasHardMatch(row) || row.createSeparate;
}
export function importRowHasHardMatch(row: ImportRowDraft): boolean {
  return row.preview.fileDuplicates.length > 0 || row.preview.candidates.some((candidate) => candidate.reasons.some((reason) => reason === "exact_email" || reason === "exact_phone"));
}
/** A name alone cannot identify which same-name record will be updated. */
export function importCandidateOptionLabel(contact: DuplicateContact): string {
  return [contact.name, contact.phone || contact.email || "No phone or email", contact.company, LEAD_STAGE_LABELS[contact.stage]].filter(Boolean).join(" · ");
}
export function ImportCandidateOption({ contact }: { contact: DuplicateContact }) {
  return <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{importCandidateOptionLabel(contact)}</span>;
}
export function ImportCandidateIdentity({ contact }: { contact: DuplicateContact }) {
  return <div className="min-w-0 space-y-1 rounded-lg bg-tint p-2 text-xs leading-relaxed" data-testid="import-candidate-identity"><p className="break-words font-semibold [overflow-wrap:anywhere]">{contact.name}</p>{contact.phone && <p className="break-words [overflow-wrap:anywhere]">Phone: {contact.phone}</p>}{contact.email && <p className="break-words [overflow-wrap:anywhere]">Email: {contact.email}</p>}{contact.company && <p className="break-words [overflow-wrap:anywhere]">Company: {contact.company}</p>}<p>Stage: {LEAD_STAGE_LABELS[contact.stage]}</p></div>;
}
export function ImportReviewValues({ values }: { values: PreviewRow["normalized"] }) {
  return <dl className="grid w-full min-w-0 gap-2 pt-2 sm:grid-cols-2">{Object.entries(values).map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-[11px] font-semibold text-muted-foreground">{LABELS[field as ImportField] || field}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{field === "source" ? LEAD_SOURCE_LABELS[value as LeadSource] || value : field === "stage" ? LEAD_STAGE_LABELS[value as LeadStage] || value : value}</dd></div>)}</dl>;
}
export function ImportFinalCounts({ counts }: { counts: { add: number; update: number; skip: number } }) {
  return <p className="mt-2 text-sm tabular">{counts.add} {counts.add === 1 ? "contact" : "contacts"} to add · {counts.update} to update · {counts.skip} {counts.skip === 1 ? "row" : "rows"} to skip</p>;
}
export function ImportMappingCounts({ rows, columns }: { rows: number; columns: number }) {
  return <p className="text-sm tabular">{rows} {rows === 1 ? "row" : "rows"} · {columns} {columns === 1 ? "column" : "columns"}</p>;
}
export function ImportReviewCounts({ total, counts }: { total: number; counts: { add: number; update: number; skip: number; undecided: number } }) {
  return <p className="text-sm tabular">{total} {total === 1 ? "row" : "rows"} · {counts.add} add · {counts.update} update · {counts.skip} skip{counts.undecided ? ` · ${counts.undecided} ${counts.undecided === 1 ? "needs" : "need"} a choice` : ""}</p>;
}
export function reviewedImportRows(rows: readonly ImportRowDraft[]): ReviewedImportRow[] | null {
  if (!rows.every(importRowReady)) return null;
  const targets = rows.filter((row) => row.decision === "update").map((row) => row.targetId);
  if (new Set(targets).size !== targets.length) return null;
  return rows.map((row) => ({ rowNumber: row.preview.rowNumber, values: { ...row.values }, decision: row.decision!, reviewFingerprint: row.preview.reviewFingerprint,
    ...(row.decision === "add" && row.createSeparate ? { createSeparate: true } : {}), ...(row.decision === "update" ? { targetId: row.targetId, expectedUpdatedAt: row.expectedUpdatedAt } : {}) }));
}
export function importNeedsEngagement(rows: readonly ImportRowDraft[]): boolean {
  return rows.some((row) => row.decision !== "skip" && (row.preview.normalized.stage === "representation" || row.preview.normalized.stage === "active_client"));
}
export function ImportResultView({ result }: { result: ImportResult }) {
  return <><div className="flex items-start gap-3 rounded-panel border border-border bg-tint p-4"><IconWell icon={Check} /><div><h3 className="text-sm font-semibold">Import result</h3><p className="mt-1 text-sm tabular">{result.counts.added} added · {result.counts.updated} updated · {result.counts.skipped} skipped</p></div></div><ul className="space-y-2">{result.rows.map((row) => <li key={row.rowNumber} className="flex justify-between gap-3 border-b border-border pb-2 text-xs"><span>Row {row.rowNumber}</span><span className="font-semibold">{row.status === "added" ? "Added" : row.status === "updated" ? "Updated" : "Skipped"}</span></li>)}</ul></>;
}

export function ContactImport(props: ContactImportProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <ImportWorkspace {...props} />}</Dialog>;
}
function ImportWorkspace({ onOpenChange, onPreview, onCommit, onDone }: ContactImportProps) {
  const prefix = useId();
  const [step, setStep] = useState<"input" | "mapping" | "review" | "confirm" | "results">("input");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [rows, setRows] = useState<ImportRowDraft[]>([]);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const [engagement, setEngagement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusHeading = () => setTimeout(() => { if (body.current) body.current.scrollTop = 0; heading.current?.focus(); }, 0);
  const move = (next: typeof step) => { setStep(next); setError(null); focusHeading(); };
  const ready = rows.length > 0 && !needsRecheck && reviewedImportRows(rows) !== null;
  const acknowledgement = importNeedsEngagement(rows);
  const counts = { add: rows.filter((row) => row.decision === "add").length, update: rows.filter((row) => row.decision === "update").length, skip: rows.filter((row) => row.decision === "skip").length, undecided: rows.filter((row) => !row.decision).length };
  async function readFile(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > IMPORT_LIMITS.bytes) { setError("Choose a CSV file no larger than 1 MB."); return; }
    setBusy(true);
    try { setText(await file.text()); setFileName(file.name); } catch { setError("The file could not be read. Choose it again or paste the CSV below."); } finally { setBusy(false); }
  }
  function readColumns() {
    const next = parseContactCsv(text);
    if (!next.ok) { setError(next.error); focusHeading(); return; }
    setParsed(next); setMapping(suggestImportMapping(next.headers)); move("mapping");
  }
  async function checkRows(raw?: ImportRawRow[]) {
    setBusy(true); setError(null);
    try {
      const input = raw ?? rows.map((row) => ({ rowNumber: row.preview.rowNumber, values: row.values }));
      if (new TextEncoder().encode(JSON.stringify({ rows: input })).length > IMPORT_LIMITS.bytes) { setError("Mapped rows exceed the 1 MB request limit. Remove columns or split the file before checking."); return; }
      const preview = await onPreview({ rows: input });
      setRows(importDraftsFromPreview(preview, raw ? [] : rows)); setNeedsRecheck(false); setEngagement(false); move("review");
    } catch { setError("Rows could not be checked. Your mapped information is kept. Try again."); focusHeading(); }
    finally { setBusy(false); }
  }
  function previewMapping() {
    if (!parsed) return;
    const fields = Object.values(mapping);
    if (!fields.length) { setError("Map at least one column before checking rows."); return; }
    if (new Set(fields).size !== fields.length) { setError("Use each CSV column once. Set duplicate mappings to Ignore."); return; }
    void checkRows(mapImportRows(parsed, mapping));
  }
  function changeValue(rowNumber: number, field: ImportField, value: string) {
    setRows((current) => current.map((row) => row.preview.rowNumber === rowNumber ? { ...row, values: { ...row.values, [field]: value } } : row));
    setNeedsRecheck(true); setEngagement(false);
  }
  function choose(rowNumber: number, decision: ImportDecision) {
    setRows((current) => current.map((row) => row.preview.rowNumber === rowNumber ? { ...row, decision, targetId: undefined, expectedUpdatedAt: undefined, createSeparate: false } : row)); setEngagement(false);
  }
  function changePage(next: number) {
    setPage(next); setExpanded(null);
    const first = rows[(next - 1) * PAGE_SIZE]?.preview.rowNumber;
    if (first !== undefined) setTimeout(() => document.getElementById(`${prefix}-row-heading-${first}`)?.focus(), 0);
  }
  async function commit() {
    const reviewed = reviewedImportRows(rows);
    if (!reviewed || needsRecheck || (acknowledgement && !engagement) || busy) return;
    const body = { rows: reviewed, ...(acknowledgement ? { engagementAcknowledged: true as const } : {}) };
    if (new TextEncoder().encode(JSON.stringify(body)).length > IMPORT_LIMITS.bytes - 100) { setError("The reviewed import exceeds 1 MB. Go back and reduce the rows or text before saving."); return; }
    retry.current = contactReviewRequest(retry.current, body);
    setBusy(true); setError(null);
    try { setResult(await onCommit({ ...body, requestId: retry.current.requestId })); move("results"); onDone?.(); }
    catch (failure) {
      const stale = failure && typeof failure === "object" && "status" in failure && failure.status === 409;
      if (stale) { setNeedsRecheck(true); move("review"); setError("Saved contacts or this review changed. Your rows and choices are kept. Recheck rows and review current matches before importing."); }
      else { setError("The import did not return a result. Your reviewed rows are kept. Retry uses the same request so contacts are not added twice."); focusHeading(); }
    } finally { setBusy(false); }
  }
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <DialogContent hideClose={busy} className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={(event) => busy && event.preventDefault()} onPointerDownOutside={(event) => (busy || step !== "input") && event.preventDefault()}>
      <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:p-5 sm:pr-14"><div className="flex items-center gap-2.5"><IconWell icon={FileUp} /><DialogTitle ref={heading} tabIndex={-1}>Import contacts</DialogTitle></div><DialogDescription className="text-xs leading-relaxed">{step === "input" ? "Choose a file, map its columns, and review every row before saving." : step === "mapping" ? "Map the columns you want to use. Unmapped columns stay out of the import." : step === "review" ? "Correct rows and choose how to handle matches. Nothing is saved yet." : step === "confirm" ? "Review the final decisions before applying this import." : "These are the saved results returned by the import."}</DialogDescription></DialogHeader>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5"><fieldset disabled={busy} className="min-w-0 space-y-4 border-0 p-0">
        {error && <p role="alert" className="rounded-panel border border-border bg-tint p-3 text-sm leading-relaxed">{error}</p>}
        {step === "input" && <><div className="grid gap-2"><Label htmlFor={`${prefix}-file`}>CSV file</Label><Input id={`${prefix}-file`} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain" className="h-auto min-h-11 py-2" onChange={(event) => void readFile(event.target.files?.[0])} />{fileName && <p className="break-words text-xs text-muted-foreground">{fileName}</p>}<p className="text-xs leading-relaxed text-muted-foreground">Up to 1 MB, {IMPORT_LIMITS.rows} rows and {IMPORT_LIMITS.columns} columns. File contents stay local until you map and check the rows.</p></div><div className="grid gap-2"><Label htmlFor={`${prefix}-paste`}>Or paste CSV</Label><Textarea id={`${prefix}-paste`} rows={8} value={text} onChange={(event) => { setText(event.target.value); setFileName(""); }} className="text-xs" spellCheck={false} /></div></>}
        {step === "mapping" && parsed && <><ImportMappingCounts rows={parsed.rows.length} columns={parsed.headers.length} /><div className="grid gap-3 sm:grid-cols-2">{IMPORT_FIELDS.map((field) => <div key={field} className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-map-${field}`}>{LABELS[field]}</Label><Select value={mapping[field] === undefined ? "ignore" : String(mapping[field])} onValueChange={(value) => setMapping((current) => { const next = { ...current }; if (value === "ignore") delete next[field]; else next[field] = Number(value); return next; })}><SelectTrigger id={`${prefix}-map-${field}`} className="h-10 min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ignore">Ignore</SelectItem>{parsed.headers.map((header, index) => <SelectItem key={index} value={String(index)}>{header || `Column ${index + 1}`}</SelectItem>)}</SelectContent></Select></div>)}</div><p className="text-xs leading-relaxed text-muted-foreground">Full name is kept as a preferred name. It is not split into guessed first and last names. Import creates contacts in your own book.</p></>}
        {step === "review" && <><div className="flex flex-wrap items-center justify-between gap-3"><ImportReviewCounts total={rows.length} counts={counts} /><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void checkRows()}>{busy ? "Checking rows…" : "Recheck rows"}</Button></div>{needsRecheck && <p role="status" className="text-xs leading-relaxed text-muted-foreground">Rows changed. Recheck them before final review.</p>}{rows.filter((row) => row.decision === "update" && row.targetId).some((row, index, matches) => matches.findIndex((match) => match.targetId === row.targetId) !== index) && <p role="alert" className="text-xs text-destructive">More than one row updates the same contact. Keep one update and skip or correct the others.</p>}<p className="text-xs leading-relaxed text-muted-foreground">Matches are suggestions. Updates use only nonblank imported values; imported notes are added as separate notes. Adding a separate contact despite a match requires an explicit choice.</p><div className="space-y-3">{visible.map((row) => <article key={row.preview.rowNumber} className="min-w-0 rounded-panel border border-border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 id={`${prefix}-row-heading-${row.preview.rowNumber}`} tabIndex={-1} className="break-words text-sm font-semibold">Row {row.preview.rowNumber} · {row.values.preferredName || row.values.fullName || [row.values.firstName, row.values.lastName].filter(Boolean).join(" ") || "Name needed"}</h3><p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{[row.values.email, row.values.phone].filter(Boolean).join(" · ") || "No email or phone provided"}</p></div><Button type="button" size="sm" variant="ghost" aria-expanded={expanded === row.preview.rowNumber} aria-controls={`${prefix}-row-${row.preview.rowNumber}`} onClick={() => setExpanded((current) => current === row.preview.rowNumber ? null : row.preview.rowNumber)}>{expanded === row.preview.rowNumber ? "Close fields" : "Correct fields"}</Button></div>{row.decision === "add" && !(row.preview.normalized.firstName || row.preview.normalized.lastName || row.preview.normalized.preferredName) && <p className="mt-3 text-xs text-destructive">Add a name before creating a separate contact.</p>}{row.decision === "update" && row.targetId && !importRowReady(row) && row.preview.errors.length === 0 && <p className="mt-3 text-xs text-destructive">The selected stage cannot be applied to this saved contact. Correct the stage and recheck the row.</p>}{row.preview.errors.length > 0 && <ul className="mt-3 space-y-1 text-xs text-destructive">{row.preview.errors.map((issue, index) => <li key={index}>{LABELS[issue.field as ImportField] || issue.field}: {issue.message}</li>)}</ul>}{row.preview.fileDuplicates.length > 0 && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Also matches {row.preview.fileDuplicates.length === 1 ? "row" : "rows"} {row.preview.fileDuplicates.join(", ")} in this file.</p>}{row.preview.candidates.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs font-semibold">Existing contact suggestions</p>{row.preview.candidates.map((match) => <div key={match.contact.id} className="rounded-lg bg-tint p-2 text-xs leading-relaxed"><p className="break-words font-medium">{match.contact.name}</p><p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{[match.contact.email, match.contact.phone].filter(Boolean).join(" · ")}</p><p className="mt-1 text-muted-foreground">{match.reasons.map((reason) => reason === "exact_email" ? "Same email" : reason === "exact_phone" ? "Same phone" : "Similar name · advisory").join(" · ")}</p></div>)}{row.preview.candidateHasMore && <p className="text-xs leading-relaxed text-muted-foreground">More similar-name suggestions exist beyond those shown. All exact email and phone matches are included.</p>}</div>}<div className="mt-3 grid gap-1.5"><Label htmlFor={`${prefix}-decision-${row.preview.rowNumber}`}>Row decision</Label><Select value={row.decision ?? ""} onValueChange={(value) => choose(row.preview.rowNumber, value as ImportDecision)}><SelectTrigger id={`${prefix}-decision-${row.preview.rowNumber}`} className="h-10"><SelectValue placeholder="Choose add, update or skip" /></SelectTrigger><SelectContent><SelectItem value="add">Add a new contact</SelectItem>{row.preview.candidates.length > 0 && <SelectItem value="update">Update an existing match</SelectItem>}<SelectItem value="skip">Skip this row</SelectItem></SelectContent></Select></div>{row.decision === "update" && <div className="mt-3 grid gap-1.5"><Label htmlFor={`${prefix}-target-${row.preview.rowNumber}`}>Contact to update</Label><Select value={row.targetId ?? ""} onValueChange={(value) => { const match = row.preview.candidates.find((candidate) => candidate.contact.id === value); if (match) setRows((current) => current.map((item) => item.preview.rowNumber === row.preview.rowNumber ? { ...item, targetId: value, expectedUpdatedAt: match.contact.updatedAt } : item)); }}><SelectTrigger id={`${prefix}-target-${row.preview.rowNumber}`} className="h-10"><SelectValue placeholder="Choose the saved contact" /></SelectTrigger><SelectContent className="max-w-[calc(100vw-2rem)]">{row.preview.candidates.map((match) => <SelectItem key={match.contact.id} value={match.contact.id} textValue={importCandidateOptionLabel(match.contact)}><ImportCandidateOption contact={match.contact} /></SelectItem>)}</SelectContent></Select>{row.targetId && row.preview.candidates.filter((match) => match.contact.id === row.targetId).map((match) => <div key={match.contact.id} className="mt-1 space-y-2"><p className="text-xs font-semibold">Selected contact to update</p><ImportCandidateIdentity contact={match.contact} /></div>)}</div>}{row.decision === "add" && importRowHasHardMatch(row) && <div className="mt-3 flex min-h-10 items-center gap-2"><Checkbox id={`${prefix}-separate-${row.preview.rowNumber}`} checked={row.createSeparate} onCheckedChange={(checked) => setRows((current) => current.map((item) => item.preview.rowNumber === row.preview.rowNumber ? { ...item, createSeparate: checked === true } : item))} /><Label htmlFor={`${prefix}-separate-${row.preview.rowNumber}`} className="py-2 text-xs font-normal leading-relaxed">Add this as a separate contact despite the suggested matches</Label></div>}{expanded === row.preview.rowNumber && <div id={`${prefix}-row-${row.preview.rowNumber}`} className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">{IMPORT_FIELDS.map((field) => <div key={field} className={`grid min-w-0 gap-1.5${field === "about" || field === "notes" ? " sm:col-span-2" : ""}`}><Label htmlFor={`${prefix}-${row.preview.rowNumber}-${field}`}>{LABELS[field]}</Label>{field === "about" || field === "notes" ? <Textarea id={`${prefix}-${row.preview.rowNumber}-${field}`} rows={3} value={row.values[field] ?? ""} onChange={(event) => changeValue(row.preview.rowNumber, field, event.target.value)} /> : <Input id={`${prefix}-${row.preview.rowNumber}-${field}`} className="h-10" value={row.values[field] ?? ""} onChange={(event) => changeValue(row.preview.rowNumber, field, event.target.value)} />}</div>)}</div>}</article>)}</div>{rows.length > PAGE_SIZE && <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-muted-foreground tabular">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} {rows.length === 1 ? "row" : "rows"}</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={page * PAGE_SIZE >= rows.length || busy} onClick={() => changePage(page + 1)}>Next</Button></div></div>}</>}
        {step === "confirm" && <><div className="rounded-panel border border-border bg-tint p-4"><p className="text-sm font-semibold">Apply this reviewed import</p><ImportFinalCounts counts={counts} /><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Each update uses the saved contact version you reviewed. A changed match stops the import for a fresh review.</p></div>{acknowledgement && <div className="flex items-start gap-2 rounded-panel border border-input p-3"><Checkbox id={`${prefix}-engagement`} className="mt-1" checked={engagement} onCheckedChange={(checked) => setEngagement(checked === true)} /><Label htmlFor={`${prefix}-engagement`} className="py-1 text-xs font-normal leading-relaxed">I confirm an active brokerage engagement is in place for imported contacts entering Representation or Active client. FortMark does not verify or store an engagement document here.</Label></div>}<ul className="space-y-2">{rows.map((row) => <li key={row.preview.rowNumber} className="flex min-w-0 flex-wrap justify-between gap-2 border-b border-border pb-2 text-xs"><span className="break-words">Row {row.preview.rowNumber} · {row.values.preferredName || row.values.fullName || [row.values.firstName, row.values.lastName].filter(Boolean).join(" ") || "Skipped row"}</span><span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{row.decision === "update" ? `Update ${row.preview.candidates.find((match) => match.contact.id === row.targetId) ? importCandidateOptionLabel(row.preview.candidates.find((match) => match.contact.id === row.targetId)!.contact) : "reviewed contact"}` : row.decision === "add" ? "Add" : "Skip"}</span><ImportReviewValues values={row.preview.normalized} /></li>)}</ul></>}
        {step === "results" && result && <ImportResultView result={result} />}
      </fieldset></div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-card p-4 sm:p-5"><Button type="button" variant="ghost" disabled={busy} onClick={() => step === "mapping" ? move("input") : step === "confirm" ? move("review") : onOpenChange(false)}>{step === "mapping" || step === "confirm" ? "Back" : step === "results" ? "Close" : "Cancel"}</Button>{step === "input" && <Button type="button" disabled={!text.trim() || busy} onClick={readColumns}>Read columns</Button>}{step === "mapping" && <Button type="button" disabled={busy} onClick={previewMapping}>{busy ? "Checking rows…" : "Check mapped rows"}</Button>}{step === "review" && <Button type="button" disabled={!ready || busy} onClick={() => move("confirm")}>Final review</Button>}{step === "confirm" && <Button type="button" disabled={busy || !ready || (acknowledgement && !engagement)} onClick={() => void commit()}>{busy ? "Applying reviewed rows…" : "Apply reviewed import"}</Button>}{step === "results" && <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>}</div>
    </DialogContent>
  );
}
