/**
 * Leads adapter — the browser's view of the contact domain.
 *
 * The server decides the source (the database or the labelled sample set)
 * and this module asks it once. In `db` mode every read and write is a call
 * to the contacts routes; in `sample` mode the same contract is served
 * locally. Every row carries the `recordSource` it came from.
 */
import { apiPath } from "@/lib/routes";
import {
  createSampleLead,
  editSampleLead,
  getSampleLead,
  listSampleLeadAgents,
  markSampleLeadContacted,
  setSampleLeadFollowUp,
  listSampleLeads,
  updateSampleLeadStage,
  type LeadFilters,
} from "../sample-leads";
import { bumpDataVersion } from "../store";
import type { DateRange, Lead, LeadStage } from "../types";
import { delay } from "./latency";
import { followUpInstant, type FollowUpOutcome } from "../../contacts/follow-up.ts";
import type { ContactQuery } from "../../contacts/filters.ts";
import { applyQuery, snapshotOf, type LeadPage, type LeadSnapshot } from "../../contacts/windows.ts";
import type { TimelineItem } from "../../contacts/timeline.ts";
import type { NoteView } from "../../contacts/notes.ts";
import type { CreateNeedInput, NeedView, UpdateNeedInput } from "../../contacts/needs.ts";
import type { LinkedTransaction } from "../../contacts/linked.ts";
import type { Birthday } from "../../contacts/birthday.ts";

export type { LeadFilters };

export class LeadsError extends Error {
  readonly code: string;
  readonly status: number;
  /** Which fields a 400 named. Names only — never what was typed. */
  readonly fields: string[];
  constructor(code: string, status: number, fields: string[] = []) {
    super(`Contacts request failed (${status}: ${code})`);
    this.name = "LeadsError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

type Source = "db" | "sample";

/**
 * One fetch, with a single retry for a READ that never got an answer — the
 * connection dropped, or a gateway said 502/504 — which is what a deployment
 * swapping underneath the page looks like. A write is never retried (it may have
 * happened), and neither is any answer the application itself gave.
 */
async function fetchOnce(path: string, init: RequestInit | undefined, read: boolean): Promise<Response> {
  const send = () =>
    fetch(apiPath(path), {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  if (!read) return send();
  try {
    const first = await send();
    if (first.status !== 502 && first.status !== 504) return first;
  } catch {
    // fall through to the one retry
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return send();
}

async function request<T>(path: string, init?: RequestInit, options: { read?: boolean } = {}): Promise<T> {
  const read = options.read ?? (init?.method === undefined || init.method === "GET");
  const response = await fetchOnce(path, init, read);
  if (!response.ok) {
    let code = "unknown";
    let fields: string[] = [];
    try {
      const body = (await response.json()) as { error?: unknown; fields?: unknown };
      if (typeof body.error === "string") code = body.error;
      if (Array.isArray(body.fields)) fields = body.fields.filter((f): f is string => typeof f === "string");
    } catch {
      // A non-JSON failure body is still a failure; the status says enough.
    }
    throw new LeadsError(code, response.status, fields);
  }
  return (await response.json()) as T;
}

let sourcePromise: Promise<Source> | null = null;

export function getLeadSource(): Promise<Source> {
  if (!sourcePromise) {
    sourcePromise = request<{ source: Source }>("/api/contacts/source")
      .then((r) => r.source)
      .catch((error) => {
        sourcePromise = null;
        throw error;
      });
  }
  return sourcePromise;
}

export async function getLeads(filters?: LeadFilters, range?: DateRange): Promise<Lead[]> {
  if ((await getLeadSource()) === "sample") {
    await delay();
    return listSampleLeads(filters, range);
  }
  const fields: Record<string, string> = {};
  if (filters?.stage?.length) fields.stage = filters.stage.join(",");
  if (filters?.source?.length) fields.source = filters.source.join(",");
  if (filters?.agentId) fields.agent = filters.agentId;
  if (filters?.query) fields.q = filters.query;

  // A search term never travels in a URL: it is a client's name, their phone
  // number or their email, and the request line is what the platform logs.
  // Text goes to the POST form of the same read; everything else stays a GET.
  const { items } = filters?.query
    ? await request<{ items: Lead[] }>("/api/contacts/search", {
        method: "POST",
        body: JSON.stringify(fields),
      })
    : await request<{ items: Lead[] }>(
        `/api/contacts${new URLSearchParams(fields).toString() ? `?${new URLSearchParams(fields)}` : ""}`
      );
  return range ? items.filter((l) => {
    const t = new Date(l.createdDate).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  }) : items;
}

export async function getLead(id: string): Promise<Lead | undefined> {
  if ((await getLeadSource()) === "sample") {
    await delay(120);
    return getSampleLead(id);
  }
  try {
    const { contact } = await request<{ contact: Lead }>(`/api/contacts/${encodeURIComponent(id)}`);
    return contact;
  } catch (error) {
    if (error instanceof LeadsError && error.status === 404) return undefined;
    throw error;
  }
}

/**
 * A move the lifecycle refuses throws `invalid_transition`; never silent.
 * `engagementAcknowledged` records that the person confirmed the engagement notice
 * when moving into Representation or Active client — it is a confirmation, not a
 * claim that a document exists.
 */
export async function updateLeadStage(
  id: string,
  stage: LeadStage,
  options: { engagementAcknowledged?: boolean } = {}
): Promise<Lead | undefined> {
  if ((await getLeadSource()) === "sample") {
    await delay(150);
    return updateSampleLeadStage(id, stage);
  }
  const { contact } = await request<{ contact: Lead }>(
    `/api/contacts/${encodeURIComponent(id)}/stage`,
    { method: "POST", body: JSON.stringify({ stage, ...(options.engagementAcknowledged ? { engagementAcknowledged: true } : {}) }) }
  );
  bumpDataVersion();
  return contact;
}

export interface QuickCreateLeadInput {
  name: string;
  email: string;
  phone: string;
  /** No longer asked at quick create: what a person wants is a client need, added after. */
  intent?: Lead["intent"];
  source?: Lead["source"];
  /** Optional month and day; never a year. */
  birthday?: Birthday;
  /** Dollars, as typed. */
  budget?: number;
  neighborhood?: string;
  notes?: string;
}

export async function createLead(input: QuickCreateLeadInput): Promise<Lead> {
  if ((await getLeadSource()) === "sample") {
    await delay(220);
    return createSampleLead({ ...input, intent: input.intent ?? "other" });
  }
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const kinds =
    !input.intent ? [] :
    input.intent === "both" ? ["buyer", "seller"] :
    input.intent === "buy" ? ["buyer"] :
    input.intent === "sell" ? ["seller"] :
    input.intent === "lease" ? ["tenant"] :
    input.intent === "invest" ? ["investor"] : [];
  const { contact } = await request<{ contact: Lead }>("/api/contacts", {
    method: "POST",
    body: JSON.stringify({
      firstName,
      lastName: rest.join(" ") || undefined,
      email: input.email.trim() || undefined,
      phone: input.phone.trim() || undefined,
      source: input.source,
      notes: input.notes || undefined,
      birthday: input.birthday,
      opportunities: kinds.map((kind) => ({
        kind,
        area: input.neighborhood || undefined,
        budgetMaxCents: input.budget !== undefined ? Math.round(input.budget * 100) : undefined,
      })),
    }),
  });
  bumpDataVersion();
  return contact;
}

/**
 * "Mark contacted today": logs a touch. In the database that is an activity
 * row, which is what stamps last-contacted; the sample set stamps the row.
 */
export async function markContacted(id: string): Promise<Lead | undefined> {
  if ((await getLeadSource()) === "sample") {
    await delay(120);
    return markSampleLeadContacted(id);
  }
  const { contact } = await request<{ contact: Lead }>(
    `/api/contacts/${encodeURIComponent(id)}/activities`,
    { method: "POST", body: JSON.stringify({ kind: "note", summary: "Marked contacted" }) }
  );
  bumpDataVersion();
  return contact;
}

export type TouchKind = "call" | "email" | "sms" | "meeting" | "showing" | "note";

export interface LogTouchInput {
  kind: TouchKind;
  summary: string;
  /** `YYYY-MM-DD`: set or reschedule the next follow-up to this day. */
  nextFollowUpDay?: string;
  /** Mark the current follow-up done. Ignored when a new day is given. */
  completeFollowUp?: boolean;
}

/**
 * Log a touch, optionally rescheduling or completing the follow-up. Without
 * either, the stored follow-up is kept: an attempted touch completes nothing.
 */
export async function logTouch(id: string, input: LogTouchInput): Promise<Lead | undefined> {
  if ((await getLeadSource()) === "sample") {
    await delay(120);
    return markSampleLeadContacted(id, {
      day: input.nextFollowUpDay,
      completeFollowUp: input.completeFollowUp,
    });
  }
  const body: Record<string, unknown> = { kind: input.kind, summary: input.summary.trim() };
  if (input.nextFollowUpDay) body.nextFollowUpAt = followUpInstant(input.nextFollowUpDay);
  else if (input.completeFollowUp) body.completeFollowUp = true;
  const { contact } = await request<{ contact: Lead }>(
    `/api/contacts/${encodeURIComponent(id)}/activities`,
    { method: "POST", body: JSON.stringify(body) }
  );
  bumpDataVersion();
  return contact;
}

export type FollowUpChange = { action: "schedule"; day: string } | { action: "complete" };

/**
 * Schedule, reschedule or complete the follow-up WITHOUT logging a touch.
 * A reminder is not an interaction: this never moves last contact and adds
 * nothing to the activity history.
 */
export async function changeFollowUp(id: string, change: FollowUpChange): Promise<{ lead: Lead | undefined; outcome?: FollowUpOutcome }> {
  if ((await getLeadSource()) === "sample") {
    await delay(120);
    return {
      lead: setSampleLeadFollowUp(id, change.action === "schedule" ? { day: change.day } : { complete: true }),
    };
  }
  const { contact, followUp } = await request<{ contact: Lead; followUp: FollowUpOutcome }>(
    `/api/contacts/${encodeURIComponent(id)}/follow-up`,
    { method: "POST", body: JSON.stringify(change) }
  );
  bumpDataVersion();
  return { lead: contact, outcome: followUp };
}

/** Agents the filter may list. Sample roster, or the brokerage's real users. */
export async function getLeadAgents(): Promise<{ id: string; name: string }[]> {
  if ((await getLeadSource()) === "sample") return listSampleLeadAgents();
  const { items } = await request<{ items: { id: string; name: string }[] }>("/api/contacts/agents");
  return items;
}

// --- Leads V2: the paged, filtered workspace ------------------------------------------

export type { ContactQuery, LeadPage, LeadSnapshot, TimelineItem };

/** A query as the wire carries it: comma lists, `1` flags. Search text is not in it. */
export function queryFields(query: ContactQuery): Record<string, string> {
  const f: Record<string, string> = {};
  if (query.stage?.length) f.stage = query.stage.join(",");
  if (query.source?.length) f.source = query.source.join(",");
  if (query.intent?.length) f.intent = query.intent.join(",");
  if (query.agentId) f.agent = query.agentId;
  if (query.mine) f.mine = "1";
  if (query.active) f.active = "1";
  if (query.followUp) f.followUp = query.followUp;
  if (query.lastTouch) f.lastTouch = query.lastTouch;
  if (query.created) f.created = query.created;
  if (query.sort) f.sort = query.sort;
  if (query.dir) f.dir = query.dir;
  if (query.page) f.page = String(query.page);
  if (query.pageSize) f.pageSize = String(query.pageSize);
  return f;
}

/**
 * One page of contacts, filtered, sorted and paged by the server. In the
 * database there is no client-side narrowing of any kind: what comes back is
 * the answer. (The labelled sample set is small and complete, so the same rules
 * run over it locally.)
 */
export async function getLeadsPage(query: ContactQuery): Promise<LeadPage> {
  if ((await getLeadSource()) === "sample") {
    await delay();
    return applyQuery(listSampleLeads(), query, new Date());
  }
  const fields = queryFields(query);
  // Search text never travels in a URL (see `getLeads`); it goes to the POST form.
  if (query.q) {
    // A POST, but a read: it is safe to ask twice.
    return request<LeadPage>("/api/contacts/search", { method: "POST", body: JSON.stringify({ ...fields, q: query.q }) }, { read: true });
  }
  const qs = new URLSearchParams(fields).toString();
  return request<LeadPage>(`/api/contacts${qs ? `?${qs}` : ""}`);
}

export async function getLeadSnapshot(): Promise<LeadSnapshot> {
  if ((await getLeadSource()) === "sample") {
    await delay(120);
    return snapshotOf(listSampleLeads(), new Date());
  }
  return (await request<{ snapshot: LeadSnapshot }>("/api/contacts/summary")).snapshot;
}

export interface ContactEdit {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: Lead["source"];
  notes?: string;
  /** A real month and day, or null to clear. Never a year. */
  birthday?: Birthday | null;
}

/** Edit a contact's details. Empty text clears a field. Refusals throw `LeadsError`. */
export async function updateContact(id: string, patch: ContactEdit): Promise<{ lead: Lead | undefined; changed: string[] }> {
  if ((await getLeadSource()) === "sample") {
    await delay(150);
    const name = [patch.firstName, patch.lastName].filter(Boolean).join(" ");
    return { lead: editSampleLead(id, { ...patch, name: patch.preferredName || name || undefined }), changed: Object.keys(patch) };
  }
  const { contact, changed } = await request<{ contact: Lead; changed: string[] }>(`/api/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  bumpDataVersion();
  return { lead: contact, changed };
}

/** What happened with a person, newest first, in the domain's words. */
export async function getTimeline(id: string): Promise<TimelineItem[]> {
  if ((await getLeadSource()) === "sample") return [];
  const { items } = await request<{ items: TimelineItem[] }>(`/api/contacts/${encodeURIComponent(id)}/timeline`);
  return items;
}

// --- Contacts V3: notes, client needs, eligible contacts, linked deals ---------------------

export type { NoteView, NeedView, LinkedTransaction };

/** A contact's live notes, newest first. Private CRM data; nothing is cached client-side. */
export async function getNotes(id: string): Promise<NoteView[]> {
  if ((await getLeadSource()) === "sample") return [];
  const { items } = await request<{ items: NoteView[] }>(`/api/contacts/${encodeURIComponent(id)}/notes`);
  return items;
}

export async function addNote(id: string, body: string): Promise<NoteView> {
  const { note } = await request<{ note: NoteView }>(`/api/contacts/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  // The timeline reads the same history, so let it refetch.
  bumpDataVersion();
  return note;
}

/** Removes the note's text. There is no edit: a correction is a new note. */
export async function deleteNote(id: string, noteId: string): Promise<void> {
  await request<{ deleted: boolean }>(`/api/contacts/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
  bumpDataVersion();
}

export async function getNeeds(id: string): Promise<NeedView[]> {
  if ((await getLeadSource()) === "sample") return [];
  const { items } = await request<{ items: NeedView[] }>(`/api/contacts/${encodeURIComponent(id)}/needs`);
  return items;
}

export async function createNeed(id: string, input: CreateNeedInput): Promise<NeedView> {
  const { need } = await request<{ need: NeedView }>(`/api/contacts/${encodeURIComponent(id)}/needs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  bumpDataVersion();
  return need;
}

export async function updateNeed(id: string, needId: string, patch: UpdateNeedInput): Promise<{ need: NeedView; changed: string[] }> {
  const result = await request<{ need: NeedView; changed: string[] }>(
    `/api/contacts/${encodeURIComponent(id)}/needs/${encodeURIComponent(needId)}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
  bumpDataVersion();
  return result;
}

/**
 * Contacts a new transaction may be opened for — Representation only, within the
 * caller's own scope, at most 25. The typed name travels in a POST body, never a URL.
 */
export async function getEligibleContacts(q?: string): Promise<{ id: string; name: string }[]> {
  if ((await getLeadSource()) === "sample") return [];
  const { items } = await request<{ items: { id: string; name: string }[] }>(
    "/api/contacts/eligible",
    { method: "POST", body: JSON.stringify(q ? { q } : {}) },
    { read: true }
  );
  return items;
}

/** The deals this contact is on, limited to the ones the viewer may see. */
export async function getLinkedTransactions(id: string): Promise<LinkedTransaction[]> {
  if ((await getLeadSource()) === "sample") return [];
  const { items } = await request<{ items: LinkedTransaction[] }>(`/api/contacts/${encodeURIComponent(id)}/transactions`);
  return items;
}
