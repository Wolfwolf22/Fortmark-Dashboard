/** Internal calendar projections retain their source records and business-day semantics. */
export const CALENDAR_TIME_ZONE = "America/New_York";
export const CALENDAR_KINDS = ["showing", "tour", "transaction_deadline", "next_action", "reminder", "personal"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  showing: "Showings", tour: "Tour plans", transaction_deadline: "Transaction deadlines", next_action: "Client next actions", reminder: "Follow-up reminders",
  personal: "My calendar items",
};
export type CalendarRescheduleRef =
  | { kind: "showing"; sourceId: string; expectedUpdatedAt: string }
  | { kind: "next_action"; sourceId: string; expectedUpdatedAt: string; actionId: string }
  | { kind: "transaction_deadline"; sourceId: string; expectedUpdatedAt: string; deadlineId: string; expectedDeadlineUpdatedAt: string };
export interface CalendarItem {
  id: string;
  kind: CalendarKind;
  title: string;
  subtitle: string;
  /** Canonical New York calendar day; all-day items never fabricate UTC instants. */
  day: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  sourceId: string;
  sourceHref: string;
  sourceLabel: string;
  /** Only booked appointments block availability. Tour starts and tasks are points. */
  blocksTime: boolean;
  tourIds?: string[];
  reschedule: CalendarRescheduleRef | null;
  label?: import("./personal-domain").CalendarLabel | null;
  /** Per-user label revision; personal items use their original record revision. */
  annotation?: { labelId: string | null; updatedAt: string | null };
  personal?: { updatedAt: string; canEdit: boolean };
}
export interface CalendarQuery {
  fromDay: string;
  /** Exclusive day boundary. */
  toDay: string;
  kinds?: CalendarKind[];
}
export interface CalendarSourceState {
  kind: CalendarKind;
  status: "available" | "unavailable" | "not_configured";
  truncated: boolean;
  /** Visible matching rows only; null when the source could not be read. */
  total: number | null;
}
export interface CalendarPage {
  items: CalendarItem[];
  sources: CalendarSourceState[];
  fromDay: string;
  toDay: string;
  timeZone: typeof CALENDAR_TIME_ZONE;
  generatedAt: string;
  labels?: import("./personal-domain").CalendarLabel[];
  labelsStatus?: "available" | "unavailable" | "not_configured";
}
export interface CalendarWarning {
  id: string;
  kind: "overlap" | "planning_buffer";
  itemIds: [string, string];
  day: string;
  message: string;
  gapMinutes: number;
}
export interface CalendarRescheduleInput {
  requestId: string;
  source: CalendarRescheduleRef;
  /** Required for a timed source; end is required only for showings. */
  startsAt?: string;
  endsAt?: string;
  /** Required for an all-day transaction deadline. */
  dueDate?: string;
}
