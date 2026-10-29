/** Bounded text-only CSV import. Cells are strings; formulas are never evaluated. */
import { z } from "zod";
import { toE164 } from "../profile/normalize.ts";
import { LEAD_SOURCE_LABELS, type LeadSource, type LeadStage } from "../data/types.ts";
import { ALL_CONTACT_STAGES, CONTACT_STAGE_LABELS } from "./stages.ts";
import type { DuplicateMatch } from "./duplicates.ts";

export const IMPORT_LIMITS = { bytes: 1_048_576, rows: 250, columns: 50, cell: 10_000 } as const;
export const IMPORT_FIELDS = ["firstName", "lastName", "preferredName", "fullName", "email", "phone", "company", "source", "stage", "about", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRawValues = Partial<Record<ImportField, string>>;
export interface ImportRawRow { rowNumber: number; values: ImportRawValues }
export interface ImportValues { firstName?: string; lastName?: string; preferredName?: string; email?: string; phone?: string; company?: string; source?: LeadSource; stage?: LeadStage; about?: string; notes?: string }
export interface ImportFieldError { field: ImportField; message: string }
export type CsvDelimiter = "," | ";" | "\t";
export interface ParsedContactCsv { ok: true; headers: string[]; rows: { rowNumber: number; cells: string[] }[]; delimiter: CsvDelimiter }
export type CsvParseResult = ParsedContactCsv | { ok: false; error: string };

function parseDelimited(text: string, delimiter: CsvDelimiter): CsvParseResult {
  const records: string[][] = []; let cells: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { cells.push(cell); cell = ""; closed = false; if (cells.length > IMPORT_LIMITS.columns) throw new Error("Use at most 50 columns."); };
  const pushRecord = () => { pushCell(); records.push(cells); cells = []; if (records.length > 10_000) throw new Error("The file contains too many blank records."); };
  try {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
        else cell += ch;
      } else if (ch === delimiter) pushCell();
      else if (ch === "\n" || ch === "\r") { pushRecord(); if (ch === "\r" && text[i + 1] === "\n") i++; }
      else if (ch === '"') { if (cell || closed) throw new Error("A quote must start a quoted cell."); quoted = true; }
      else { if (closed) throw new Error("Unexpected text after a closing quote."); cell += ch; }
      if (cell.length > IMPORT_LIMITS.cell) throw new Error("A cell exceeds the 10,000-character limit.");
    }
    if (quoted) throw new Error("A quoted cell is not closed.");
    if (cell || cells.length || closed) pushRecord();
    if (!records.length || records[0].every(value => !value.trim())) throw new Error("The file needs a header row.");
    const headers = records[0].map((value, i) => value.trim() || `Column ${i + 1}`);
    const rows = records.slice(1).map((record, index) => ({ rowNumber: index + 2, cells: record })).filter(row => row.cells.some(value => value.trim()));
    if (rows.length > IMPORT_LIMITS.rows) throw new Error("Use at most 250 data rows.");
    if (!rows.length) throw new Error("The file has no data rows.");
    if (rows.some(row => row.cells.length !== headers.length)) throw new Error("Each data row must have the same number of cells as the header.");
    return { ok: true, headers, rows, delimiter };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The CSV could not be read." }; }
}
export function parseContactCsv(value: string, delimiter?: CsvDelimiter): CsvParseResult {
  if (new TextEncoder().encode(value).length > IMPORT_LIMITS.bytes) return { ok: false, error: "Use a CSV file of at most 1 MiB." };
  if (value.includes("\0")) return { ok: false, error: "The file contains an unsupported character." };
  const text = value.replace(/^\uFEFF/, "");
  if (delimiter) return parseDelimited(text, delimiter);
  const delimiters = [",", ";", "\t"] as const, counts = new Map<CsvDelimiter, number>(delimiters.map(item => [item, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (text[i] === "\r" || text[i] === "\n")) break;
    else if (!quoted && counts.has(text[i] as CsvDelimiter)) counts.set(text[i] as CsvDelimiter, counts.get(text[i] as CsvDelimiter)! + 1);
  }
  const max = Math.max(...counts.values());
  // A malformed multi-column file must not silently become a one-column file
  // merely because a different delimiter can parse each whole line as text.
  const candidates = max ? delimiters.filter(item => counts.get(item) === max) : [","] as const;
  const choices = candidates.map(candidate => parseDelimited(text, candidate));
  const valid = choices.filter((choice): choice is ParsedContactCsv => choice.ok).sort((a, b) => b.headers.length - a.headers.length);
  return valid[0] ?? choices[0];
}
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADER_ALIASES: Record<ImportField, string[]> = {
  firstName: ["firstname", "first", "givenname"], lastName: ["lastname", "last", "surname", "familyname"],
  preferredName: ["preferredname", "displayname", "nickname"], fullName: ["fullname", "name", "contactname"],
  email: ["email", "emailaddress", "primaryemail"], phone: ["phone", "phonenumber", "mobile", "cell", "telephone"],
  company: ["company", "organization", "organisation", "business"], source: ["source", "leadsource"], stage: ["stage", "contactstage", "relationshipstage"],
  about: ["about", "aboutclient", "description"], notes: ["notes", "note", "contactnotes"],
};
export function suggestImportMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  for (const field of IMPORT_FIELDS) { const index = headers.findIndex(header => HEADER_ALIASES[field].includes(key(header))); if (index >= 0) mapping[field] = index; }
  return mapping;
}
export function mapImportRows(parsed: ParsedContactCsv, mapping: Partial<Record<ImportField, number>>): ImportRawRow[] {
  return parsed.rows.map(row => ({ rowNumber: row.rowNumber, values: Object.fromEntries(IMPORT_FIELDS.flatMap(field => {
    const index = mapping[field]; return Number.isInteger(index) && index! >= 0 && index! < parsed.headers.length ? [[field, row.cells[index!] ?? ""]] : [];
  })) }));
}
const SOURCE_VALUES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];
function enumValue<T extends string>(value: string, values: readonly T[], labels: Record<T, string>): T | undefined { return values.find(item => key(item) === key(value) || key(labels[item]) === key(value)); }
export function normalizeImportRow(row: ImportRawRow): { values: ImportValues; errors: ImportFieldError[] } {
  const values: ImportValues = {}, errors: ImportFieldError[] = [];
  const limits: Partial<Record<ImportField, number>> = { firstName: 100, lastName: 100, preferredName: 100, fullName: 100, email: 320, phone: 40, company: 200, about: 2000, notes: 10000 };
  for (const field of IMPORT_FIELDS) {
    const value = row.values[field]?.trim(); if (!value) continue;
    if (value.includes("\0") || value.length > (limits[field] ?? 200)) { errors.push({ field, message: `Check the length and characters in ${field}.` }); continue; }
    if (field === "email") { if (!z.email().safeParse(value).success) errors.push({ field, message: "Enter a valid email address." }); else values.email = value.toLowerCase(); }
    else if (field === "phone") { const phone = toE164(value); if (!phone) errors.push({ field, message: "Enter a readable phone number." }); else values.phone = phone; }
    else if (field === "stage") { const stage = enumValue(value, ALL_CONTACT_STAGES, CONTACT_STAGE_LABELS); if (!stage) errors.push({ field, message: "Choose a known contact stage." }); else values.stage = stage; }
    else if (field === "source") { const source = enumValue(value, SOURCE_VALUES, LEAD_SOURCE_LABELS); if (!source) errors.push({ field, message: "Choose a known contact source." }); else values.source = source; }
    else if (field === "fullName") { if (!row.values.preferredName?.trim()) values.preferredName = value; }
    else Object.assign(values, { [field]: value });
  }
  return { values, errors };
}
const rawValuesSchema = z.object(Object.fromEntries(IMPORT_FIELDS.map(field => [field, z.string().max(IMPORT_LIMITS.cell).optional()])) as Record<ImportField, z.ZodOptional<z.ZodString>>).strict();
export const importRawRowSchema = z.object({ rowNumber: z.number().int().min(1).max(10000), values: rawValuesSchema }).strict();
const uniqueRows = (rows: { rowNumber: number }[]) => new Set(rows.map(row => row.rowNumber)).size === rows.length;
export const importPreviewInputSchema = z.object({ rows: z.array(importRawRowSchema).min(1).max(IMPORT_LIMITS.rows).refine(uniqueRows, "Row numbers must be unique") }).strict();
export type ImportPreviewInput = z.infer<typeof importPreviewInputSchema>;
export interface ImportPreviewRow { rowNumber: number; values: ImportRawValues; normalized: ImportValues; errors: ImportFieldError[]; candidates: DuplicateMatch[]; candidateHasMore?: boolean; fileDuplicates: number[]; reviewFingerprint: string; recommendedDecision: "add" | "skip" }
export interface ImportPreview { rows: ImportPreviewRow[]; counts: { total: number; valid: number; invalid: number; matched: number } }
export const importCommitRowSchema = importRawRowSchema.extend({ decision: z.enum(["add", "update", "skip"]), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), createSeparate: z.boolean().optional(), targetId: z.string().uuid().optional(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).strict().superRefine((row, ctx) => {
  if (row.decision === "update" && (!row.targetId || !row.expectedUpdatedAt)) ctx.addIssue({ code: "custom", message: "Choose an update target and its reviewed version", path: ["targetId"] });
  if (row.decision !== "update" && (row.targetId || row.expectedUpdatedAt)) ctx.addIssue({ code: "custom", message: "Only updates can name an existing contact", path: ["targetId"] });
});
export const importCommitInputSchema = z.object({ requestId: z.string().uuid(), engagementAcknowledged: z.boolean().optional(), rows: z.array(importCommitRowSchema).min(1).max(IMPORT_LIMITS.rows).refine(uniqueRows, "Row numbers must be unique") }).strict();
export type ImportCommitInput = z.infer<typeof importCommitInputSchema>;
export interface ImportResult { rows: { rowNumber: number; status: "added" | "updated" | "skipped"; contactId?: string }[]; counts: { added: number; updated: number; skipped: number } }
