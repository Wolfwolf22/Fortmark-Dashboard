/**
 * The two ways a surface declares its data is not real.
 *
 * Both read from `lib/data/provenance.ts`, so neither can claim something the
 * provenance table does not say. Passing a live domain renders nothing at all
 * rather than a "Sample" label on real data.
 *
 * Server-safe: no hooks, no client directive, so a server component can render
 * the notice without pulling this into the client bundle.
 */
import { isSample, sampleNotice, type DataDomain } from "@/lib/data/provenance";
import { cn } from "@/lib/utils";

/**
 * The chip on a widget header.
 *
 * Quiet on purpose. It has to be readable without competing with the number it
 * qualifies — a widget that shouts SAMPLE louder than its own value is
 * unusable, and one that whispers it is dishonest.
 */
export function SampleChip({
  domain,
  className,
}: {
  domain: DataDomain;
  className?: string;
}) {
  if (!isSample(domain)) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
      // The visible word is an abbreviation; the title carries the full
      // meaning for anyone who needs it spelled out.
      title="Sample data — not your live business"
    >
      Sample
    </span>
  );
}

/**
 * The line under a page title.
 *
 * States the consequence, not just the category: "not your live business" and
 * "nothing here is saved" are the two things a user actually needs to know
 * before acting on what they see.
 */
export function SampleNotice({
  domain,
  className,
}: {
  domain: DataDomain;
  className?: string;
}) {
  if (!isSample(domain)) return null;
  return (
    <p
      role="note"
      className={cn("text-[12px] leading-snug text-muted-foreground", className)}
    >
      {sampleNotice(domain)}
    </p>
  );
}
