"use client";

/**
 * Quick views, search and filters for the Contacts workspace.
 *
 * A quick view is a preset over the same query — choosing one sets exactly its
 * filters and nothing else, and the filters stay visible and editable, so a view
 * is never a hidden dataset. Every filter here is answered by the server; this
 * component only says what to ask. Search text is held by the page and never put
 * in a URL.
 */
import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CREATED_FILTERS,
  FOLLOW_UP_FILTERS,
  INTENTS,
  LAST_TOUCH_FILTERS,
  matchingView,
  QUICK_VIEWS,
  SOURCES,
  type ContactQuery,
} from "@/lib/contacts/filters";
import { ALL_CONTACT_STAGES } from "@/lib/contacts/stages";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { INTENT_LABELS } from "./lead-shared";

const FOLLOW_UP_LABELS: Record<(typeof FOLLOW_UP_FILTERS)[number], string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  none: "None set",
};
const LAST_TOUCH_LABELS: Record<(typeof LAST_TOUCH_FILTERS)[number], string> = {
  today: "Today",
  "7d": "7+ days ago",
  "14d": "14+ days ago",
  "30d": "30+ days ago",
  never: "Never",
};
const CREATED_LABELS: Record<(typeof CREATED_FILTERS)[number], string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  allLabel: string;
  value: string | undefined;
  options: [string, string][];
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const shortLabel = label.replace("Filter by ", "");
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <p className="text-xs font-medium text-muted-foreground" aria-hidden>{shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1)}</p>
      <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : v)}>
        <SelectTrigger aria-label={label} className="h-10 min-w-0 w-full text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LeadsFilters({
  query,
  search,
  onSearch,
  onChange,
  onApplyView,
  onClear,
  agents,
  stageCounts,
  brokerageWide,
}: {
  query: ContactQuery;
  search: string;
  onSearch: (text: string) => void;
  onChange: (patch: Partial<ContactQuery>) => void;
  onApplyView: (filters: ContactQuery) => void;
  onClear: () => void;
  agents: { id: string; name: string }[];
  stageCounts: Record<string, number> | undefined;
  /** A privileged role sees the whole brokerage; anyone else's list already is their own. */
  brokerageWide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = matchingView(query);
  // For someone who only ever sees their own contacts, "All" and "Mine" are the
  // same list: show one, and call it what it is.
  const views = QUICK_VIEWS.filter((v) => brokerageWide || v.id !== "mine").map((v) => ({
    ...v,
    label: !brokerageWide && v.id === "all" ? "My contacts" : v.label,
  }));
  const narrowing =
    Boolean(search) ||
    Object.keys(query).some((k) => !["sort", "dir", "page", "pageSize", "q"].includes(k) && query[k as keyof ContactQuery] !== undefined);
  const stage = query.stage?.length === 1 ? query.stage[0] : undefined;
  const applied: string[] = [];
  if (query.active) applied.push("Open contacts");
  if (query.mine) applied.push("Assigned to me");
  if (query.stage?.length) applied.push(`Stage: ${query.stage.map((s) => LEAD_STAGE_LABELS[s]).join(", ")}`);
  if (query.source?.length) applied.push(`Source: ${query.source.map((s) => LEAD_SOURCE_LABELS[s]).join(", ")}`);
  if (query.intent?.length) applied.push(`Intent: ${query.intent.map((i) => INTENT_LABELS[i]).join(", ")}`);
  if (query.agentId && brokerageWide) applied.push(`Agent: ${agents.find((a) => a.id === query.agentId)?.name ?? "Selected agent"}`);
  if (query.followUp) applied.push(`Follow-up: ${FOLLOW_UP_LABELS[query.followUp]}`);
  if (query.lastTouch) applied.push(`Last touch: ${LAST_TOUCH_LABELS[query.lastTouch]}`);
  if (query.created) applied.push(`Added: ${CREATED_LABELS[query.created]}`);
  const activeCount = applied.length + (search ? 1 : 0);

  return (
    <Card className="min-w-0 space-y-4 p-4 sm:p-5">
      <div className="min-w-0 space-y-4 lg:flex lg:items-center lg:gap-4 lg:space-y-0">
      <div
        role="group"
        aria-label="Quick views"
        className="-m-1 flex min-w-0 gap-1 overflow-x-auto p-1 [scrollbar-width:thin] lg:flex-1"
      >
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={current === v.id}
            data-testid={`view-${v.id}`}
            onClick={() => onApplyView(v.filters as ContactQuery)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors duration-150",
              current === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-tint hover:text-foreground"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
        <div className="relative min-w-0 flex-1 basis-36 sm:basis-64 lg:w-60 lg:flex-none lg:basis-auto">
          <Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, email, phone or area"
            aria-label="Search contacts"
            className="h-11 pl-9 text-[13px]"
            maxLength={120}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          aria-label="Filters"
          aria-expanded={open}
          aria-controls="lead-filter-panel"
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeCount > 0 && <span aria-hidden className="rounded-md bg-tint px-1.5 text-xs tabular">{activeCount}</span>}
        </Button>
        {narrowing && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        )}
      </div>
      </div>

      {applied.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2" aria-label="Applied filters">
          {applied.map((label) => <Badge key={label} variant="muted" className="max-w-full rounded-md px-2 py-1 text-xs font-medium leading-relaxed [overflow-wrap:anywhere]">{label}</Badge>)}
        </div>
      )}

      <div
        id="lead-filter-panel"
        className={cn(open ? "grid" : "hidden", "grid-cols-2 gap-3 border-t border-border pt-4 md:grid-cols-3 xl:grid-cols-4")}
      >
        <FilterSelect
          label="Filter by stage"
          allLabel="All stages"
          value={stage}
          options={ALL_CONTACT_STAGES.map((s) => [s, `${LEAD_STAGE_LABELS[s as LeadStage]}${stageCounts ? ` (${stageCounts[s] ?? 0})` : ""}`])}
          onChange={(v) => onChange({ stage: v ? [v as LeadStage] : undefined })}
        />
        <FilterSelect
          label="Filter by source"
          allLabel="All sources"
          value={query.source?.[0]}
          options={SOURCES.map((s) => [s, LEAD_SOURCE_LABELS[s]])}
          onChange={(v) => onChange({ source: v ? [v as (typeof SOURCES)[number]] : undefined })}
        />
        <FilterSelect
          label="Filter by intent"
          allLabel="Any intent"
          value={query.intent?.[0]}
          options={INTENTS.map((i) => [i, INTENT_LABELS[i]])}
          onChange={(v) => onChange({ intent: v ? [v as (typeof INTENTS)[number]] : undefined })}
        />
        {brokerageWide && agents.length > 0 && (
          <FilterSelect
            label="Filter by agent"
            allLabel="All agents"
            value={query.agentId}
            options={agents.map((a) => [a.id, a.name])}
            onChange={(v) => onChange({ agentId: v, mine: undefined })}
          />
        )}
        <FilterSelect
          label="Filter by follow-up"
          allLabel="Any follow-up"
          value={query.followUp}
          options={FOLLOW_UP_FILTERS.map((f) => [f, FOLLOW_UP_LABELS[f]])}
          onChange={(v) => onChange({ followUp: v as ContactQuery["followUp"] })}
        />
        <FilterSelect
          label="Filter by last touch"
          allLabel="Any last touch"
          value={query.lastTouch}
          options={LAST_TOUCH_FILTERS.map((f) => [f, LAST_TOUCH_LABELS[f]])}
          onChange={(v) => onChange({ lastTouch: v as ContactQuery["lastTouch"] })}
        />
        <FilterSelect
          label="Filter by date added"
          allLabel="Added any time"
          value={query.created}
          options={CREATED_FILTERS.map((f) => [f, CREATED_LABELS[f]])}
          onChange={(v) => onChange({ created: v as ContactQuery["created"] })}
        />
      </div>
    </Card>
  );
}
