import type { TransactionVendorDetail } from "@/lib/transactions/vendor-detail-domain";
import { DEFAULT_VENDOR_DETAIL_FIELDS,vendorMonthlyBreakdown } from "@/lib/transactions/vendor-detail-domain";
import type { TransactionVendorRecordedSummary,TransactionVendorSelectionView,VendorRole } from "@/lib/transactions/vendor-domain";
import { formatTransactionDay } from "@/lib/transactions/calendar-days";
import { formatVendorMoney } from "./vendor-detail-overview";

export function recordedVendorSummary(detail:TransactionVendorDetail):TransactionVendorRecordedSummary {
  const {notes:_notes,...fields}=detail.details;
  return {details:fields,attachmentCount:detail.attachments.length,hasNotes:Boolean(_notes.trim()),updatedAt:detail.updatedAt};
}
export function currentVendorRecordedSummary(selection:TransactionVendorSelectionView|undefined,local:TransactionVendorDetail|undefined,transactionId:string):TransactionVendorRecordedSummary|null|undefined {
  if(selection?.status!=="selected")return null;
  return local&&local.transactionId===transactionId&&local.id===selection.detailId&&local.vendorId===selection.vendorId&&local.role===selection.role&&local.isCurrent&&(!selection.detailSummary||Date.parse(local.updatedAt)>=Date.parse(selection.detailSummary.updatedAt))?recordedVendorSummary(local):selection.detailSummary;
}
export function vendorCardFacts(role:VendorRole,summary:TransactionVendorRecordedSummary):{label:string;value:string}[] {
  const fields={...DEFAULT_VENDOR_DETAIL_FIELDS,...summary.details},facts:{label:string;value:string}[]=[],add=(label:string,value:string|null)=>{if(value!==null)facts.push({label,value});},money=(value:number|null)=>value===null?null:formatVendorMoney(value);
  if(fields.serviceStatus!=="not_recorded")add("Service status",{scheduled:"Scheduled",completed:"Completed",cancelled:"Cancelled"}[fields.serviceStatus]);
  if(fields.serviceDate)add("Service date",formatTransactionDay(fields.serviceDate));
  add("Cost",money(fields.costCents));
  if(role==="mortgage") {
    add("Preapproval",money(fields.preApprovalAmountCents));if(fields.preApprovalExpiryDate)add("Preapproval expires",formatTransactionDay(fields.preApprovalExpiryDate));
    add("Loan amount",money(fields.loanAmountCents));
    if(fields.interestRatePercent!==null)add("Interest rate",`${fields.interestRatePercent}%${fields.rateType!=="not_recorded"?` · ${{fixed:"Fixed",adjustable:"Adjustable",other:"Other"}[fields.rateType]}`:""}`);
    if(fields.aprPercent!==null)add("APR",`${fields.aprPercent}%`);
    if(fields.termMonths!==null)add("Term",`${fields.termMonths} months`);
    for(const [field,label] of [["monthlyPrincipalInterestCents","Principal & interest / month"],["monthlyPropertyTaxCents","Property tax / month"],["monthlyHomeInsuranceCents","Home insurance / month"],["monthlyMortgageInsuranceCents","Mortgage insurance / month"],["monthlyHoaCents","HOA / month"],["monthlyOtherCents","Other / month"]] as const)add(label,money(fields[field]));
    add("Closing costs",money(fields.estimatedClosingCostsCents));add("Cash to close",money(fields.estimatedCashToCloseCents));
    if(fields.lenderMonthlyTotalCents!==null)add("Lender monthly total",money(fields.lenderMonthlyTotalCents));
    else {const subtotal=vendorMonthlyBreakdown(fields);if(subtotal.subtotalCents!==null)add(`Monthly components${subtotal.complete?"":" · incomplete"}`,formatVendorMoney(subtotal.subtotalCents));}
    if(fields.quoteDate)add("Quote as of",formatTransactionDay(fields.quoteDate));
  }
  if(fields.reference)add("Invoice / reference",fields.reference);
  return facts;
}
export function VendorRecordedSummary({role,summary}:{role:VendorRole;summary:TransactionVendorRecordedSummary|null|undefined}) {
  if(!summary)return <p className="pt-2 text-xs text-muted-foreground">Open Full detail to review recorded information.</p>;
  const facts=vendorCardFacts(role,summary);
  return <div className="mt-3 space-y-2 border-t border-border pt-3" aria-label="Recorded vendor details">{facts.length?<dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">{facts.map(fact=><div key={fact.label} className="min-w-0"><dt className="text-[11px] leading-relaxed text-muted-foreground">{fact.label}</dt><dd className="mt-0.5 break-words text-xs font-medium tabular [overflow-wrap:anywhere]">{fact.value}</dd></div>)}</dl>:<p className="text-xs text-muted-foreground">No service or financing figures recorded yet.</p>}<p className="text-[11px] text-muted-foreground">{summary.attachmentCount} {summary.attachmentCount===1?"file":"files"} attached{summary.hasNotes?" · Private note recorded":""}</p></div>;
}
