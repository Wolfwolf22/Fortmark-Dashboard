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
  getSampleLead,
  listSampleLeadAgents,
  markSampleLeadContacted,
  listSampleLeads,
  updateSampleLeadStage,
  type LeadFilters,
} from "../sample-leads";
import { bumpDataVersion } from "../store";
import type { DateRange, Lead, LeadStage } from "../types";
import { delay } from "./latency";

export type { LeadFilters };

export class LeadsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`Contacts request failed (${status}: ${code})`);
    this.name = "LeadsError";
    this.code = code;
    this.status = status;
  }
}

type Source = "db" | "sample";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let code = "unknown";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // A non-JSON failure body is still a failure; the status says enough.
    }
    throw new LeadsError(code, response.status);
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

/** A move the lifecycle refuses throws `invalid_transition`; never silent. */
export async function updateLeadStage(id: string, stage: LeadStage): Promise<Lead | undefined> {
  if ((await getLeadSource()) === "sample") {
    await delay(150);
    return updateSampleLeadStage(id, stage);
  }
  const { contact } = await request<{ contact: Lead }>(
    `/api/contacts/${encodeURIComponent(id)}/stage`,
    { method: "POST", body: JSON.stringify({ stage }) }
  );
  bumpDataVersion();
  return contact;
}

export interface QuickCreateLeadInput {
  name: string;
  email: string;
  phone: string;
  intent: Lead["intent"];
  source?: Lead["source"];
  /** Dollars, as typed. */
  budget?: number;
  neighborhood?: string;
  notes?: string;
}

export async function createLead(input: QuickCreateLeadInput): Promise<Lead> {
  if ((await getLeadSource()) === "sample") {
    await delay(220);
    return createSampleLead(input);
  }
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const kinds =
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

/** Agents the filter may list. Sample roster, or the brokerage's real users. */
export async function getLeadAgents(): Promise<{ id: string; name: string }[]> {
  if ((await getLeadSource()) === "sample") return listSampleLeadAgents();
  const { items } = await request<{ items: { id: string; name: string }[] }>("/api/contacts/agents");
  return items;
}
