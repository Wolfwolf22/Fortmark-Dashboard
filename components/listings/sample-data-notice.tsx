"use client";

import { FlaskConical } from "lucide-react";

/**
 * Shown whenever a screen is on a sample source.
 *
 * The sample generators are convincing by design, which is exactly why they
 * must never be mistaken for the brokerage's MLS, deals or contacts. This is
 * the label that makes the difference visible on the screen itself, not only
 * in a config. `subject` names what is sample; the default is the listings'.
 */
export function SampleDataNotice({
  subject = "These listings are generated for development and are not from the MLS.",
}: {
  subject?: string;
}) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-panel bg-tint px-3 py-2 text-[13px] text-muted-foreground"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold text-foreground">Sample data.</span> {subject}
      </span>
    </p>
  );
}
