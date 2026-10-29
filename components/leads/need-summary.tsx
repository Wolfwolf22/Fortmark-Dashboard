import { Badge } from "@/components/ui/badge";
import { NEED_STATUS_LABELS, needReadDetails, summarizeNeed, type NeedView } from "@/lib/contacts/needs";

/** A read view shared by active and historical needs. Editing is a separate permission. */
export function NeedSummary({ need }: { need: NeedView }) {
  const { headline, lines } = summarizeNeed(need);
  const details = needReadDetails(need);
  return (
    <div data-testid="need-summary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="break-words text-sm font-semibold">{headline}</p>
        {need.status !== "active" && <Badge variant="muted">{NEED_STATUS_LABELS[need.status]}</Badge>}
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
          {lines.map((line) => <li key={line} className="break-words [overflow-wrap:anywhere]">{line}</li>)}
        </ul>
      )}
      {details.length > 0 && (
        <dl className="mt-3 space-y-3 border-t border-border pt-3">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt className="text-[11px] font-semibold text-muted-foreground">{detail.label}</dt>
              <dd className="mt-1 text-[13px] leading-relaxed">
                {detail.values.length === 1 ? (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{detail.values[0]}</p>
                ) : (
                  <ul className="space-y-1">{detail.values.map((value) => <li key={value} className="break-words [overflow-wrap:anywhere]">{value}</li>)}</ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {lines.length === 0 && details.length === 0 && <p className="mt-1 text-sm text-muted-foreground">No details added yet.</p>}
    </div>
  );
}
