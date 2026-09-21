/**
 * The sample lead source: the seeded generator set, served with the same
 * contract the contacts service honours. Isomorphic like the other sample
 * sources — the browser uses it directly in `sample` mode so quick-create
 * and stage changes keep working in memory, and the routes use it in that
 * mode for a uniform contract. Every row carries `recordSource: "sample"`.
 */
import { agents, leads, now } from "./mock/db.ts";
import { bumpDataVersion } from "./store.ts";
import type { DateRange, Lead, LeadStage } from "./types.ts";
import { inRange } from "../dates.ts";
import { canTransition } from "../contacts/stages.ts";

export interface LeadFilters {
  stage?: LeadStage[];
  source?: Lead["source"][];
  agentId?: string;
  query?: string;
}

export function listSampleLeads(filters?: LeadFilters, range?: DateRange): Lead[] {
  let result = [...leads];
  if (range) result = result.filter((l) => inRange(l.createdDate, range));
  if (filters?.stage?.length) result = result.filter((l) => filters.stage!.includes(l.stage));
  if (filters?.source?.length) result = result.filter((l) => filters.source!.includes(l.source));
  if (filters?.agentId) result = result.filter((l) => l.assignedAgentId === filters.agentId);
  if (filters?.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        (l.neighborhood ?? "").toLowerCase().includes(q)
    );
  }
  return result.sort(
    (a, b) => new Date(b.lastContactDate).getTime() - new Date(a.lastContactDate).getTime()
  );
}

export function getSampleLead(id: string): Lead | undefined {
  return leads.find((l) => l.id === id);
}

export function updateSampleLeadStage(id: string, stage: LeadStage): Lead | undefined {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return undefined;
  if (!canTransition(lead.stage, stage)) return lead;
  lead.stage = stage;
  lead.lastContactDate = now().toISOString();
  bumpDataVersion();
  return lead;
}

export function createSampleLead(
  input: Pick<Lead, "name" | "email" | "phone" | "intent"> &
    Partial<Pick<Lead, "source" | "budget" | "neighborhood" | "notes">>
): Lead {
  const created: Lead = {
    id: `lead-${leads.length + 1}-new`,
    stage: "lead",
    source: input.source ?? "website",
    assignedAgentId: "agent-1",
    createdDate: now().toISOString(),
    lastContactDate: now().toISOString(),
    notes: input.notes ?? "",
    budget: input.budget,
    neighborhood: input.neighborhood,
    name: input.name,
    email: input.email,
    phone: input.phone,
    intent: input.intent,
    recordSource: "sample",
  };
  leads.unshift(created);
  bumpDataVersion();
  return created;
}

/** "Mark contacted today": a touch, stamped on the sample row. */
export function markSampleLeadContacted(id: string): Lead | undefined {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return undefined;
  lead.lastContactDate = now().toISOString();
  bumpDataVersion();
  return lead;
}

/** The sample roster, as the agent filter lists it. */
export function listSampleLeadAgents(): { id: string; name: string }[] {
  return agents.filter((a) => a.role !== "coordinator").map((a) => ({ id: a.id, name: a.name }));
}
