/**
 * Leads adapter. Mock-backed today; swap the bodies for the CRM and the UI
 * is untouched.
 */
import { DateRange, Lead, LeadStage } from "../types";
import { leads, now } from "../mock/db";
import { bumpDataVersion } from "../store";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";

export interface LeadFilters {
  stage?: LeadStage[];
  source?: Lead["source"][];
  agentId?: string;
  query?: string;
}

export async function getLeads(
  filters?: LeadFilters,
  range?: DateRange
): Promise<Lead[]> {
  await delay();
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

export async function getLead(id: string): Promise<Lead | undefined> {
  await delay(120);
  return leads.find((l) => l.id === id);
}

export async function updateLeadStage(id: string, stage: LeadStage): Promise<Lead | undefined> {
  await delay(150);
  const lead = leads.find((l) => l.id === id);
  if (!lead) return undefined;
  lead.stage = stage;
  lead.lastContactDate = now().toISOString();
  bumpDataVersion();
  return lead;
}

export async function createLead(
  input: Pick<Lead, "name" | "email" | "phone" | "intent"> & Partial<Pick<Lead, "source" | "budget" | "neighborhood" | "notes">>
): Promise<Lead> {
  await delay(220);
  const created: Lead = {
    id: `lead-${leads.length + 1}-new`,
    stage: "new",
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
  };
  leads.unshift(created);
  bumpDataVersion();
  return created;
}
