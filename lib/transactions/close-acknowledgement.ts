import { z } from "zod";
export const CLOSE_ACKNOWLEDGEMENT_VERSION = "fortmark-close-mock-v1";
export const CLOSE_ACKNOWLEDGEMENT_TEXT = [
  "MOCK ACKNOWLEDGEMENT — demonstration workflow only",
  "This placeholder records your review of this transaction file. It is not a legal agreement, a brokerage compliance certification, or a substitute for the documents and approvals your brokerage requires.",
  "Review the saved client and property information, closing details, required checklist items and any required files before continuing. Completing this screen does not validate the contents of an uploaded document.",
  "Closing records the file as Closed and updates the dashboard using the actual closing date. A closed file becomes read-only. Reopening requires a request reviewed by an administrator.",
  "Select the acknowledgement below only after you have reviewed this placeholder and the saved file. Your confirmation records this mock version and the time of the action; it does not fabricate a signed agreement.",
] as const;
export const closeAcknowledgementSchema = z.object({ version: z.literal(CLOSE_ACKNOWLEDGEMENT_VERSION), reviewedToEnd: z.literal(true), acknowledged: z.literal(true) }).strict();
export type CloseAcknowledgement = z.infer<typeof closeAcknowledgementSchema>;
