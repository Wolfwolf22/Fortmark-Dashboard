/** Private personal work and user-defined colors. Labels supplement readable names. */
import type { CalendarKind } from "./domain.ts";
export const CALENDAR_COLORS = ["red", "amber", "green", "blue", "purple", "teal", "slate", "pink"] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];
export interface CalendarLabel {
  id: string; name: string; color: CalendarColor;
  updatedAt: string | null; archivedAt: string | null; isDefault: boolean;
}
/** Virtual defaults become stored only on a deliberate write. */
export const DEFAULT_CALENDAR_LABELS: readonly CalendarLabel[] = [
  { id: "urgent", name: "Urgent", color: "red", updatedAt: null, archivedAt: null, isDefault: true },
  { id: "important", name: "Important", color: "amber", updatedAt: null, archivedAt: null, isDefault: true },
  { id: "low-priority", name: "Low priority", color: "green", updatedAt: null, archivedAt: null, isDefault: true },
  { id: "personal", name: "Personal", color: "blue", updatedAt: null, archivedAt: null, isDefault: true },
];
export interface PersonalCalendarDetails {
  title: string; notes: string; location: string;
  day: string; allDay: boolean; startsAt: string | null; endsAt: string | null;
  blocksTime: boolean; labelId: string | null;
}
export interface PersonalCalendarRecord {
  id: string; details: PersonalCalendarDetails; label: CalendarLabel | null;
  createdAt: string; updatedAt: string; cancelledAt: string | null; canEdit: boolean;
}
export type PersonalCalendarMutation =
  | { action: "create"; requestId: string; details: PersonalCalendarDetails; expectedLabelUpdatedAt: string | null }
  | { action: "update"; requestId: string; id: string; expectedUpdatedAt: string; details: PersonalCalendarDetails; expectedLabelUpdatedAt: string | null }
  | { action: "cancel"; requestId: string; id: string; expectedUpdatedAt: string };
export type CalendarLabelMutation =
  | { action: "create"; requestId: string; details: { name: string; color: CalendarColor } }
  | { action: "update"; requestId: string; id: string; expectedUpdatedAt: string | null; details: { name: string; color: CalendarColor } }
  | { action: "archive"; requestId: string; id: string; expectedUpdatedAt: string | null };
export interface CalendarAnnotationMutation {
  requestId: string;
  item: { id: string; kind: CalendarKind; sourceId: string };
  expectedUpdatedAt: string | null;
  labelId: string | null;
  expectedLabelUpdatedAt: string | null;
}
export interface CalendarAnnotationResult {
  label: CalendarLabel | null;
  annotation: { labelId: string | null; updatedAt: string };
}
