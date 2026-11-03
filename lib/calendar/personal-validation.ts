import { z } from "zod";
import { businessDayKey, isCalendarDay } from "../metrics/business-day.ts";
import { CALENDAR_KINDS } from "./domain.ts";
import { CALENDAR_COLORS, DEFAULT_CALENDAR_LABELS } from "./personal-domain.ts";
const id = z.string().uuid(), revision = z.string().datetime({ offset: true });
const text = (cap: number) => z.string().max(cap).refine(v => !v.includes("\u0000"));
export const calendarLabelIdSchema = z.string().refine(v => DEFAULT_CALENDAR_LABELS.some(label => label.id === v) || id.safeParse(v).success);
export const personalCalendarDetailsSchema = z.object({ title: text(200).trim().min(1), notes: text(5000), location: text(500), day: z.string().refine(isCalendarDay), allDay: z.boolean(), startsAt: revision.nullable(), endsAt: revision.nullable(), blocksTime: z.boolean(), labelId: calendarLabelIdSchema.nullable() }).strict().superRefine((v, ctx) => {
  if (v.allDay) { if (v.startsAt !== null || v.endsAt !== null || v.blocksTime) ctx.addIssue({ code: "custom", message: "All-day items have a date and do not block appointment times." }); }
  else if (!v.startsAt || !v.endsAt || !Number.isFinite(Date.parse(v.startsAt)) || !Number.isFinite(Date.parse(v.endsAt)) || Date.parse(v.endsAt) <= Date.parse(v.startsAt) || Date.parse(v.endsAt) - Date.parse(v.startsAt) > 7 * 86400000 || businessDayKey(new Date(v.startsAt)) !== v.day) ctx.addIssue({ code: "custom", message: "Choose a valid New York interval up to seven days." });
});
export const personalCalendarMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId: id, details: personalCalendarDetailsSchema, expectedLabelUpdatedAt: revision.nullable() }).strict(),
  z.object({ action: z.literal("update"), requestId: id, id, expectedUpdatedAt: revision, details: personalCalendarDetailsSchema, expectedLabelUpdatedAt: revision.nullable() }).strict(),
  z.object({ action: z.literal("cancel"), requestId: id, id, expectedUpdatedAt: revision }).strict(),
]);
const labelDetails = z.object({ name: text(60).trim().min(1), color: z.enum(CALENDAR_COLORS) }).strict();
export const calendarLabelMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId: id, details: labelDetails }).strict(),
  z.object({ action: z.literal("update"), requestId: id, id: calendarLabelIdSchema, expectedUpdatedAt: revision.nullable(), details: labelDetails }).strict(),
  z.object({ action: z.literal("archive"), requestId: id, id: calendarLabelIdSchema, expectedUpdatedAt: revision.nullable() }).strict(),
]);
export const calendarAnnotationMutationSchema = z.object({ requestId: id, item: z.object({ id: z.string().min(1).max(100), kind: z.enum(CALENDAR_KINDS), sourceId: id }).strict(), expectedUpdatedAt: revision.nullable(), labelId: calendarLabelIdSchema.nullable(), expectedLabelUpdatedAt: revision.nullable() }).strict().superRefine((v, ctx) => {
  const parts = v.item.id.split(":"); if (parts.length !== 2 || !id.safeParse(parts[1]).success || parts[0] !== v.item.kind && !(v.item.kind === "transaction_deadline" && parts[0] === "closing")) ctx.addIssue({ code: "custom", message: "Invalid source identity." });
  if (["showing", "tour", "reminder", "personal"].includes(v.item.kind) && parts[1] !== v.item.sourceId || parts[0] === "closing" && parts[1] !== v.item.sourceId) ctx.addIssue({ code: "custom", message: "Invalid source identity." });
});
