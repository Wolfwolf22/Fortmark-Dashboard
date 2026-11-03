import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import { contactEngagementFiles } from "../db/schema.ts";
/** Reused inside contact stage and transaction creation atomic guards. */
export function activeEngagementGuard(contactId: string | SQLWrapper) { return sql`(select count(*) from ${contactEngagementFiles} where ${contactEngagementFiles.contactId}=${contactId}::uuid and ${contactEngagementFiles.removedAt} is null and ${contactEngagementFiles.contentType}='application/pdf' and ${contactEngagementFiles.sizeBytes} between 1 and 4194304 and ${contactEngagementFiles.sha256} ~ '^[0-9a-f]{64}$')=1`; }
