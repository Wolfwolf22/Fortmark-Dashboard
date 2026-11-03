import { z } from "zod";
import { isValidCalendarDay } from "./calendar-days.ts";

export const isListingSide = (side: string): boolean => ["listing", "landlord", "dual"].includes(side);
export const confirmedListingDatesSchema = z.object({
  goLiveDate: z.string().refine(isValidCalendarDay, "Enter the confirmed go-live date."),
  expirationDate: z.string().refine(isValidCalendarDay, "Enter the confirmed contract expiration."),
}).strict().refine(value => value.expirationDate >= value.goLiveDate, {
  path: ["expirationDate"], message: "Expiration must be on or after the go-live date.",
});
export type ConfirmedListingDates = z.infer<typeof confirmedListingDatesSchema>;

/** A feed date is a review suggestion. Days on market cannot establish an exact date. */
export function suggestedListingGoLiveDate(listedDate: string | null | undefined): string | null {
  if (!listedDate) return null;
  const day = listedDate.slice(0, 10);
  return isValidCalendarDay(day) && (listedDate === day || /^\d{4}-\d{2}-\d{2}T/.test(listedDate) && Number.isFinite(Date.parse(listedDate))) ? day : null;
}
