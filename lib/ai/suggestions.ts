import type { LucideIcon } from "lucide-react";
import { CalendarClock, ClipboardList, FileText, Mail, MessageSquare, TrendingUp } from "lucide-react";

/**
 * Suggestion chips under the AI composer. Edit this array — and only this
 * array — to change the chips. Clicking a chip fills its `prompt` into the
 * composer (falling back to `label` when `prompt` is empty) and focuses the
 * caret at the end. It never auto-sends.
 *
 * Every chip must be something the assistant can actually do TODAY. The first
 * three now depend on real records, because the assistant has read-only tools
 * over this user's contacts, transactions, deadlines and follow-ups; the rest
 * need no data at all. Nothing here asks it to read a document, send an email
 * or change a record — it cannot do any of those, and a chip that implies
 * otherwise teaches the wrong thing about the product.
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
    id: "needs-attention",
    label: "What needs my attention?",
    prompt:
      "What needs my attention this week? Check my transaction deadlines and any follow-ups that are due, and tell me what is overdue first.",
    icon: CalendarClock,
    description: "Deadlines and follow-ups, overdue first.",
  },
  {
    id: "month-so-far",
    label: "How is my month going?",
    prompt:
      "Summarize how my month is going: what has closed, what is scheduled to close, and where my pipeline stands. Say plainly if anything could not be read.",
    icon: TrendingUp,
    description: "Closed, scheduled, and pipeline to date.",
  },
  {
    id: "pipeline-review",
    label: "Walk my pipeline",
    prompt:
      "Walk me through my active transactions, newest first. For each one give the stage, the client, and the next deadline if there is one.",
    icon: ClipboardList,
    description: "Every active deal, with its next deadline.",
  },
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
    id: "offer-summary",
    label: "Summarize an offer for a seller",
    prompt:
      "I'll paste the key terms of an offer. Summarize them for my seller in a short table and flag anything they should weigh beyond the price.",
    icon: FileText,
    description: "Paste the terms; get a table and the trade-offs.",
  },
];
