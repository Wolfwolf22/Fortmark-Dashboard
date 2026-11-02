import { z } from "zod";
export const VENDOR_ROLES = ["inspector", "mortgage", "appraiser", "termite", "insurance", "title", "attorney", "other"] as const;
export type VendorRole = (typeof VENDOR_ROLES)[number];
export const VENDOR_ROLE_LABELS: Record<VendorRole, string> = { inspector: "Inspector", mortgage: "Mortgage / financing", appraiser: "Appraiser", termite: "Termite / pest", insurance: "Insurance", title: "Title / escrow", attorney: "Attorney", other: "Other approved vendor" };
const optionalText = (cap: number) => z.string().trim().max(cap).refine(v => !v.includes("\u0000")).nullable();
export const brokerageVendorFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160).refine(v => !v.includes("\u0000")), company: optionalText(160),
  email: z.string().trim().max(254).email().nullable(), phone: optionalText(40),
  categories: z.array(z.enum(VENDOR_ROLES)).min(1).max(VENDOR_ROLES.length).refine(v => new Set(v).size === v.length), approved: z.boolean(),
}).strict();
export type BrokerageVendorFields = z.infer<typeof brokerageVendorFieldsSchema>;
export interface BrokerageVendorView extends BrokerageVendorFields { id: string; updatedAt: string }
export interface BrokerageVendorDirectory { items: BrokerageVendorView[]; canManage: boolean }
export const createBrokerageVendorSchema = z.object({ requestId: z.string().uuid(), vendor: brokerageVendorFieldsSchema }).strict();
export const updateBrokerageVendorSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), vendor: brokerageVendorFieldsSchema }).strict();
export type CreateBrokerageVendorInput = z.infer<typeof createBrokerageVendorSchema>;
export type UpdateBrokerageVendorInput = z.infer<typeof updateBrokerageVendorSchema>;
export const transactionVendorMutationSchema = z.object({
  requestId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), role: z.enum(VENDOR_ROLES),
  status: z.enum(["selected", "not_needed", "unset"]), vendorId: z.string().uuid().nullable(),
  expectedVendorUpdatedAt: z.string().datetime({ offset: true }).nullable(), expectedSelectionUpdatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().refine(v => v.status === "selected" ? Boolean(v.vendorId && v.expectedVendorUpdatedAt) : v.vendorId === null && v.expectedVendorUpdatedAt === null);
export type TransactionVendorMutation = z.infer<typeof transactionVendorMutationSchema>;
export interface TransactionVendorSelectionView {
  id: string; role: VendorRole; status: "selected" | "not_needed" | "unset"; vendorId: string | null; vendorName: string | null;
  company: string | null; email: string | null; phone: string | null; approved: boolean; updatedAt: string;
}
