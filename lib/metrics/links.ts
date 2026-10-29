import { ACTIVE_CLIENT_STAGES } from "../contacts/stages.ts";
import { ROUTES } from "../routes.ts";

/** Drill into exactly the contact stages counted by Home's Active clients. */
export function activeClientsHref(): string {
  return `${ROUTES.contacts}?stage=${ACTIVE_CLIENT_STAGES.join(",")}`;
}
