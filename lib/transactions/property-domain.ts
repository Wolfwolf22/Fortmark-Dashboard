import { z } from "zod";
import type { Listing } from "../data/types.ts";
import { normalizePropertyMlsNumber,isPropertyDataset,isPropertyListingId } from "../contacts/properties.ts";
import { confirmedListingDatesSchema } from "./listing-term.ts";
const revision=z.string().datetime({offset:true});
const mls=z.string().transform((value,ctx)=>{const number=normalizePropertyMlsNumber(value);if(!number){ctx.addIssue({code:"custom",message:"Enter an exact MLS number."});return z.NEVER;}return number;});
export interface TransactionPropertyReference { dataset:string;listingId:string;mlsNumber:string }
export interface TransactionPropertyView { transactionId:string;reference:TransactionPropertyReference|null;listing:Listing|null;syncStatus:"unlinked"|"available"|"not_found"|"unavailable"|"not_configured";checkedAt:string|null;canEdit:boolean;updatedAt:string }
export interface TransactionPropertyLookup { transactionId:string;expectedUpdatedAt:string;reference:TransactionPropertyReference;listing:Listing;importFingerprint:string;checkedAt:string }
export const transactionPropertyLookupSchema=z.object({mlsNumber:mls}).strict();
const base={requestId:z.string().uuid(),expectedUpdatedAt:revision};
export const transactionPropertyMutationSchema=z.discriminatedUnion("action",[
 z.object({...base,action:z.literal("link"),mlsNumber:mls,expectedDataset:z.string().refine(isPropertyDataset),expectedListingId:z.string().refine(isPropertyListingId),expectedImportFingerprint:z.string().regex(/^[0-9a-f]{64}$/),importAddress:z.boolean(),importListPrice:z.boolean(),listingDates:confirmedListingDatesSchema.optional()}).strict(),
 z.object({...base,action:z.literal("unlink")}).strict(),
]);
export type TransactionPropertyMutation=z.infer<typeof transactionPropertyMutationSchema>;
