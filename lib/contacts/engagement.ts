/** Private brokerage engagement metadata. The system checks a PDF exists, never its legal contents. */
import { z } from "zod";
export const ENGAGEMENT_REQUIRED_STAGES = ["representation", "active_client", "under_contract"] as const;
export const ENGAGEMENT_WARNING = "FortMark records that a PDF is attached. It does not verify its contents, signatures, legal sufficiency, or whether it is the correct agreement.";
export interface ContactEngagementFile { id: string; contactId: string; filename: string; contentType: "application/pdf"; sizeBytes: number; createdAt: string; updatedAt: string }
export interface ContactEngagementState { file: ContactEngagementFile | null; contactUpdatedAt: string; canWrite: boolean; uploadsEnabled: boolean }
const revision = z.string().datetime({ offset: true });
export const contactLifecycleMutationSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: revision }).strict();
export const engagementUploadSchema = contactLifecycleMutationSchema.extend({ expectedEngagementId: z.string().uuid().nullable(), expectedEngagementUpdatedAt: revision.nullable() }).strict();
export const engagementRemoveSchema = contactLifecycleMutationSchema.extend({ engagementId: z.string().uuid(), expectedEngagementUpdatedAt: revision }).strict();
export type EngagementUploadInput = z.infer<typeof engagementUploadSchema>;
export type EngagementRemoveInput = z.infer<typeof engagementRemoveSchema>;
export type ContactLifecycleInput = z.infer<typeof contactLifecycleMutationSchema>;
