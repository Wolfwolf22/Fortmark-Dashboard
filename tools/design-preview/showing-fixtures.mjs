// Synthetic plans and visits, anchored to the current New York calendar day.
import { contactFixtureNow, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { businessLocalToUtc } from "../../lib/contacts/next-action.ts";
import { toTimeline } from "../../lib/contacts/timeline.ts";
import { SAMPLE_WATERFRONT_LIST_ID, SAMPLE_INVESTMENT_LIST_ID, SAMPLE_PERSONAL_RESEARCH_LIST_ID, SAMPLE_PRIVATE_LIST_ID, samplePropertyListRows } from "./property-fixtures.mjs";

const day = offset => { const at = new Date(`${businessDayKey(contactFixtureNow)}T12:00:00Z`); at.setUTCDate(at.getUTCDate() + offset); return at.toISOString().slice(0, 10); };
const at = (offset, time) => { const value = businessLocalToUtc(day(offset), time); if (!value.ok) throw Error("Invalid sample showing time"); return value.dueAt; };
const property = (listId, index = 0) => samplePropertyListRows[listId][index];
const plan = (number, contactId, member, offset, time, values = {}) => {
  const startsAt = at(offset, time), createdAt = new Date(contactFixtureNow.getTime() - 4 * 86_400_000).toISOString();
  return { id: `84000000-0000-4000-8000-${String(number).padStart(12, "0")}`, ownerUserId: SAMPLE_AGENT_ID, contactId, sourcePropertyId: member.id, dataset: member.dataset, listingId: member.listingId, mlsNumber: member.mlsNumber, startsAt, endsAt: new Date(Date.parse(startsAt) + 45 * 60_000).toISOString(), meetingDetails: "Meet by the main entrance.", notes: "Confirm guest parking before the appointment.", status: "scheduled", feedbackLikes: "", feedbackConcerns: "", feedbackSummary: "", visitedAt: null, cancelReason: "", createdAt, updatedAt: createdAt, ...values };
};
export const SAMPLE_UPCOMING_SHOWING_ID = "84000000-0000-4000-8000-000000000001";
export const SAMPLE_PAST_PLAN_ID = "84000000-0000-4000-8000-000000000005";
export const SAMPLE_PRIVATE_SHOWING_ID = "84000000-0000-4000-8000-000000000006";
export const sampleShowings = [
  plan(1, "sample-due-today", property(SAMPLE_WATERFRONT_LIST_ID), 1, "10:00"),
  plan(2, "sample-overdue", property(SAMPLE_PERSONAL_RESEARCH_LIST_ID), 2, "14:30", { meetingDetails: "Meet near the lobby desk.", notes: "Compare the layout with the other shortlisted option." }),
  plan(3, "sample-due-today", property(SAMPLE_WATERFRONT_LIST_ID), -2, "11:00", { status: "completed", visitedAt: at(-2, "11:45"), feedbackLikes: "Bright living area and useful storage.", feedbackConcerns: "Confirm parking arrangements.", feedbackSummary: "Worth comparing with the next option.", completionActivityId: "85000000-0000-4000-8000-000000000003" }),
  plan(4, "sample-due-today", property(SAMPLE_INVESTMENT_LIST_ID), 3, "09:00", { status: "cancelled", cancelReason: "Client asked to consider different timing." }),
  plan(5, "sample-due-today", property(SAMPLE_WATERFRONT_LIST_ID, 2), -1, "15:00", { meetingDetails: "Meet at the building entrance.", notes: "Record the actual visit if this appointment took place." }),
  plan(6, "sample-due-today", property(SAMPLE_PRIVATE_LIST_ID), 1, "12:00", { ownerUserId: SAMPLE_COLLEAGUE_ID, meetingDetails: "Private colleague appointment", notes: "This other owner's plan must not appear in the current actor's agenda." }),
];
export function sampleShowingTimelineItem(id, showingId, sourcePropertyId, visitedAt) {
  return toTimeline({ activities: [{ id, kind: "showing", summary: "Showing completed", occurredAt: new Date(visitedAt), actorUserId: SAMPLE_AGENT_ID, safeMetadata: { showingId, sourcePropertyId, event: "showing_completed" } }], followUpEvents: [], names: new Map([[SAMPLE_AGENT_ID, "Sample Agent"]]) })[0];
}
export const sampleShowingVisitTimeline = Object.fromEntries(sampleShowings.filter(showing => showing.ownerUserId === SAMPLE_AGENT_ID && showing.status === "completed").map(showing => [showing.contactId, [sampleShowingTimelineItem(showing.completionActivityId, showing.id, showing.sourcePropertyId, showing.visitedAt)]]));
