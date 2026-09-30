/**
 * The audit events that also read as a contact's history.
 *
 * Kept beside the timeline rather than in the service so a test can prove the
 * timeline shows exactly the events the writers produce, and no others.
 */
export const TIMELINE_DOMAIN_EVENTS = [
  "contact_note_created",
  "contact_note_deleted",
  "contact_need_created",
  "contact_need_updated",
  "contact_need_status_changed",
  "contact_transaction_linked",
] as const;
