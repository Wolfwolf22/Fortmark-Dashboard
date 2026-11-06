"use client";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const COMMISSION_FIELD_HELP: Readonly<Record<string,string>> = {
  contractPriceCents: "The agreed contract amount in US dollars. Enter 1250000 for $1,250,000. A percentage commission uses this amount, not the list price.",
  listPriceCents: "The entered asking price in US dollars. This figure does not determine commission; a percentage commission uses the contract price.",
  commissionRateBps: "Enter the agreed commission percentage: 2.5 means 2.5%, not 0.025 or 250. Gross commission is contract price × this percentage. A recorded flat commission takes priority.",
  commissionFlatCents: "Enter the agreed flat commission in US dollars, not cents. A recorded flat amount, including $0, takes priority over the percentage rate. Leave blank when using a percentage.",
  agentSplitBps: "Enter the agent’s percentage: 80 means 80%. It applies to gross commission after the referral fee. The transaction fee is then deducted from that share. A blank split remains unrecorded.",
  transactionFeeCents: "Enter the transaction fee in US dollars, not cents. It is deducted from the agent’s share after referral and split. The estimated agent payout has a minimum of $0.",
  referralFeeBps: "Enter the referral percentage: 25 means 25%. This percentage is deducted from gross commission before the agent split is applied. Leave blank when the referral fee is unrecorded.",
};

export function CommissionFieldHelp({field,label,id}:{field:string;label:string;id:string}) {
  const help=COMMISSION_FIELD_HELP[field];
  if(!help)return null;
  return <><span id={id} className="sr-only">{help}</span><Tooltip><TooltipTrigger asChild><button type="button" aria-label={`Help with ${label}`} aria-describedby={id} className="inline-flex h-10 w-10 shrink-0 sm:h-9 sm:w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-tint"><CircleHelp aria-hidden className="h-4 w-4"/></button></TooltipTrigger><TooltipContent className="max-w-[min(22rem,calc(100vw-3rem))] whitespace-normal p-3 text-xs font-normal leading-relaxed">{help}</TooltipContent></Tooltip></>;
}
