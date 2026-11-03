import { z } from "zod";
import { isCalendarDay } from "../metrics/business-day.ts";
const revision = z.string().datetime({ offset: true }), id = z.string().uuid();
const showing = z.object({ kind: z.literal("showing"), sourceId: id, expectedUpdatedAt: revision }).strict();
const nextAction = z.object({ kind: z.literal("next_action"), sourceId: id, expectedUpdatedAt: revision, actionId: id }).strict();
const deadline = z.object({ kind: z.literal("transaction_deadline"), sourceId: id, expectedUpdatedAt: revision, deadlineId: id, expectedDeadlineUpdatedAt: revision }).strict();
export const calendarRescheduleInputSchema = z.union([
  z.object({ requestId: id, source: showing, startsAt: revision, endsAt: revision }).strict(),
  z.object({ requestId: id, source: nextAction, startsAt: revision }).strict(),
  z.object({ requestId: id, source: deadline, dueDate: z.string().refine(isCalendarDay) }).strict(),
]);
