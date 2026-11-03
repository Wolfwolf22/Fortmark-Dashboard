import { z } from "zod";
import { deadlineInputSchema } from "./validation.ts";
import type { VendorRole } from "./vendor-domain.ts";

const day = deadlineInputSchema.shape.dueDate.nullable();
const cents = z.number().int().min(0).max(999_999_999_999).nullable();
const text = (cap: number) => z.string().trim().max(cap).refine(v => !v.includes("\u0000")).nullable();
const rate = z.string().trim().max(8).regex(/^(?:\d{1,2}|100)(?:\.\d{1,4})?$/).refine(v => Number(v) <= 100).nullable();
export const vendorDetailFieldsSchema = z.object({
  serviceDate: day, serviceStatus: z.enum(["not_recorded", "scheduled", "completed", "cancelled"]), costCents: cents, reference: text(160), notes: z.string().max(5000).refine(v => !v.includes("\u0000")),
  quoteDate: day, preApprovalAmountCents: cents, preApprovalIssuedDate: day, preApprovalExpiryDate: day,
  loanAmountCents: cents, loanType: text(100), rateType: z.enum(["not_recorded", "fixed", "adjustable", "other"]), interestRatePercent: rate, aprPercent: rate,
  termMonths: z.number().int().min(1).max(600).nullable(), rateLockExpiryDate: day,
  monthlyPrincipalInterestCents: cents, monthlyPropertyTaxCents: cents, monthlyHomeInsuranceCents: cents,
  monthlyMortgageInsuranceCents: cents, monthlyHoaCents: cents, monthlyOtherCents: cents, lenderMonthlyTotalCents: cents,
  estimatedClosingCostsCents: cents, estimatedCashToCloseCents: cents,
}).strict();
export type VendorDetailFields = z.infer<typeof vendorDetailFieldsSchema>;
export const DEFAULT_VENDOR_DETAIL_FIELDS: Readonly<VendorDetailFields> = Object.freeze({
  serviceDate: null, serviceStatus: "not_recorded", costCents: null, reference: null, notes: "",
  quoteDate: null, preApprovalAmountCents: null, preApprovalIssuedDate: null, preApprovalExpiryDate: null,
  loanAmountCents: null, loanType: null, rateType: "not_recorded", interestRatePercent: null, aprPercent: null, termMonths: null, rateLockExpiryDate: null,
  monthlyPrincipalInterestCents: null, monthlyPropertyTaxCents: null, monthlyHomeInsuranceCents: null, monthlyMortgageInsuranceCents: null, monthlyHoaCents: null, monthlyOtherCents: null, lenderMonthlyTotalCents: null, estimatedClosingCostsCents: null, estimatedCashToCloseCents: null,
});
export const VENDOR_MONTHLY_COMPONENTS = ["monthlyPrincipalInterestCents", "monthlyPropertyTaxCents", "monthlyHomeInsuranceCents", "monthlyMortgageInsuranceCents", "monthlyHoaCents", "monthlyOtherCents"] as const;
/** A subtotal of entered lender figures, never a generated mortgage payment. */
export function vendorMonthlyBreakdown(details: VendorDetailFields) {
  const entered = VENDOR_MONTHLY_COMPONENTS.flatMap(key => details[key] === null ? [] : [details[key]!]);
  const subtotalCents = entered.length ? entered.reduce((a, b) => a + b, 0) : null, complete = entered.length === VENDOR_MONTHLY_COMPONENTS.length;
  return { subtotalCents, entered: entered.length, total: VENDOR_MONTHLY_COMPONENTS.length, complete, differenceCents: complete && details.lenderMonthlyTotalCents !== null ? subtotalCents! - details.lenderMonthlyTotalCents : null };
}
export function vendorDetailFieldsValidForRole(role: VendorRole, details: VendorDetailFields): boolean {
  if (role === "mortgage") return true;
  const common = new Set(["serviceDate", "serviceStatus", "costCents", "reference", "notes"]);
  return Object.keys(DEFAULT_VENDOR_DETAIL_FIELDS).every(key => common.has(key) || details[key as keyof VendorDetailFields] === DEFAULT_VENDOR_DETAIL_FIELDS[key as keyof VendorDetailFields]);
}
export const VENDOR_ATTACHMENT_KINDS = ["report", "invoice", "pre_approval", "loan_estimate", "insurance_quote", "other"] as const;
export type VendorAttachmentKind = (typeof VENDOR_ATTACHMENT_KINDS)[number];
export interface VendorAttachmentView { id: string; detailId: string; kind: VendorAttachmentKind; filename: string; contentType: string; sizeBytes: number; createdAt: string; updatedAt: string }
export interface TransactionVendorDetail {
  id: string; transactionId: string; role: VendorRole; vendorId: string; vendorName: string; company: string | null; email: string | null; phone: string | null;
  details: VendorDetailFields; attachments: VendorAttachmentView[]; updatedAt: string; transactionUpdatedAt: string; createdAt: string; canEdit: boolean; isCurrent: boolean; attachmentUploadsEnabled: boolean;
}
export interface TransactionVendorDetailSummary { id: string; role: VendorRole; vendorName: string; vendorId: string; createdAt: string; updatedAt: string; isCurrent: boolean }
export interface TransactionVendorDetailHistory { items: TransactionVendorDetailSummary[]; total: number; limit: number }
const base = { requestId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), expectedDetailUpdatedAt: z.string().datetime({ offset: true }) };
export const transactionVendorDetailPatchSchema = z.object({ ...base, details: vendorDetailFieldsSchema }).strict();
export const transactionVendorDetailUploadSchema = z.object({ ...base, kind: z.enum(VENDOR_ATTACHMENT_KINDS) }).strict();
export const transactionVendorDetailRemoveSchema = z.object({ ...base, detailId: z.string().uuid(), expectedAttachmentUpdatedAt: z.string().datetime({ offset: true }) }).strict();
export type TransactionVendorDetailPatchInput = z.infer<typeof transactionVendorDetailPatchSchema>;
export type TransactionVendorDetailUploadInput = z.infer<typeof transactionVendorDetailUploadSchema>;
export type TransactionVendorDetailRemoveInput = z.infer<typeof transactionVendorDetailRemoveSchema>;
