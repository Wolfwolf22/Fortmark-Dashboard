import { z } from "zod";
import { edgeDefinitions } from "./edge-definitions.ts";
import { DEFAULT_WIDGET_ORDER } from "../stores/widget-order.ts";

export const namespaceSchema = z.enum(["dashboard-layout", "competitive-edge"]);
export const MAX_WORKSPACE_BYTES = 3_000_000;
export const EDGE_KEYS = ["fm-competitive-edge:farms:v1", "fm-competitive-edge:workspaces:v1", "fm-competitive-edge:parcel-campaigns:v1", "fm-competitive-edge:campaign-actions:v1", "fm-competitive-edge:logo-corrections:v1"] as const;
const period = z.enum(["today", "week", "month", "quarter", "year"]);
export const layoutSchema = z.object({
  widgetOrder: z.array(z.enum(DEFAULT_WIDGET_ORDER)).max(DEFAULT_WIDGET_ORDER.length).refine(ids => new Set(ids).size === ids.length),
  widgetPeriods: z.partialRecord(z.enum(DEFAULT_WIDGET_ORDER), period.nullable()),
}).strict();
export const workspaceWriteSchema = z.object({
  accountId: z.string().uuid(),
  namespace: namespaceSchema,
  revision: z.number().int().min(0).max(2_147_483_646),
  data: z.record(z.string(), z.string().max(2_000_000)),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value.data)).length > MAX_WORKSPACE_BYTES) ctx.addIssue({code:"custom",message:"Workspace is too large"});
  for (const [key, raw] of Object.entries(value.data)) {
    if (value.namespace === "dashboard-layout") {
      if(key==='notifications'){
        try{z.object({dealMilestones:z.boolean(),documentStatus:z.boolean(),newLeads:z.boolean(),marketDigest:z.boolean(),weeklySummary:z.boolean()}).strict().parse(JSON.parse(raw));}catch{ctx.addIssue({code:"custom",message:"Invalid notification preferences"});}
        continue;
      }
      if (key !== "layout") { ctx.addIssue({code:"custom",message:"Unsupported setting"}); continue; }
      try { if (!layoutSchema.safeParse(JSON.parse(raw)).success) throw new Error(); } catch { ctx.addIssue({code:"custom",message:"Invalid layout"}); }
    } else {
      if (!(EDGE_KEYS as readonly string[]).includes(key)) { ctx.addIssue({code:"custom",message:"Unsupported workspace collection"}); continue; }
      try {
        const data: unknown = JSON.parse(raw);
        edgeDefinitions[key].parse(data);
      } catch { ctx.addIssue({code:"custom",message:"Only personal workspace definitions can be saved"}); }
    }
  }
});
