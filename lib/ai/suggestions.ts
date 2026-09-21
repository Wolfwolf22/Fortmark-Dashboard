import type { LucideIcon } from "lucide-react";
import { ClipboardList, FileText, HelpCircle, Mail, MessageSquare, Scale } from "lucide-react";

/**
 * Suggestion chips under the AI composer. Edit this array — and only this
 * array — to change the chips. Clicking a chip fills its `prompt` into the
 * composer (falling back to `label` when `prompt` is empty) and focuses the
 * caret at the end. It never auto-sends.
 *
 * Every chip must be something the assistant can actually do TODAY. No tools
 * are connected yet — it cannot read listings, transactions, leads or
 * documents — so nothing here asks it to look anything up. These are the
 * drafting, structuring and explaining tasks it does well without data. When
 * listing tools land, chips that search or compare listings belong here;
 * not before.
 */
export interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  /** Optional small monochrome icon shown before the label. */
  icon?: LucideIcon;
  /** Optional one-line description shown beneath the label. */
  description?: string;
}

export const SUGGESTIONS: Suggestion[] = [
  {
    id: "price-reduction-email",
    label: "Draft a price-reduction email",
    prompt:
      "Draft an email to my seller recommending a price reduction. I'll give you the address, current price, days on market and the showing feedback — ask me for anything you need.",
    icon: Mail,
    description: "To a seller, with the reasoning laid out plainly.",
  },
  {
    id: "showing-follow-up",
    label: "Follow up after a showing",
    prompt:
      "Draft a short follow-up to a buyer's agent after Saturday's showing. Keep it to one paragraph, state the next step, and don't pressure.",
    icon: MessageSquare,
    description: "One paragraph, next step stated, no pressure.",
  },
  {
    id: "cma-structure",
    label: "Structure a CMA",
    prompt:
      "Lay out the structure of a comparative market analysis I can fill in: the sections, what each needs, and how to present the adjustments. I'll supply the comps.",
    icon: Scale,
    description: "The sections and adjustment grid, for you to fill in.",
  },
  {
    id: "listing-appointment-checklist",
    label: "Listing appointment checklist",
    prompt:
      "Give me a checklist for a listing appointment on a South Florida single-family home: what to bring, what to ask, and what to leave with the seller.",
    icon: ClipboardList,
    description: "What to bring, ask, and leave behind.",
  },
  {
    id: "explain-inspection",
    label: "Explain the inspection period",
    prompt:
      "Explain to a first-time buyer what happens during the inspection period on a Florida residential contract, in plain language, and what decisions they'll face.",
    icon: HelpCircle,
    description: "Plain language for a first-time buyer.",
  },
  {
    id: "offer-summary",
    label: "Summarize an offer for a seller",
    prompt:
      "I'll paste the key terms of an offer. Summarize them for my seller in a short table and flag anything they should weigh beyond the price.",
    icon: FileText,
    description: "Paste the terms; get a table and the trade-offs.",
  },
];
