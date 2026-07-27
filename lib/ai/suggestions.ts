import type { LucideIcon } from "lucide-react";

/**
 * Suggestion chips under the AI composer. Edit this array — and only this
 * array — to change the chips. Clicking a chip fills its `prompt` into the
 * composer (falling back to `label` when `prompt` is empty) and focuses the
 * caret at the end. It never auto-sends.
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
  { id: "s1", label: "Suggestion 1", prompt: "" },
  { id: "s2", label: "Suggestion 2", prompt: "" },
  { id: "s3", label: "Suggestion 3", prompt: "" },
  { id: "s4", label: "Suggestion 4", prompt: "" },
  { id: "s5", label: "Suggestion 5", prompt: "" },
  { id: "s6", label: "Suggestion 6", prompt: "" },
];
