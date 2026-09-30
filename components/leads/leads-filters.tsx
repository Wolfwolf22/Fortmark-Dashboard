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
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : v)}>
      <SelectTrigger aria-label={label} className={cn("w-full md:w-40", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Quick views"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={current === v.id}
            data-testid={`view-${v.id}`}
            onClick={() => onApplyView(v.filters as ContactQuery)}
            className={cn(
              "whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current === v.id ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, email, phone or area"
            aria-label="Search contacts"
            className="pl-9"
            maxLength={120}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:hidden"
          aria-expanded={open}
          aria-controls="lead-filter-panel"
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden />
          Filters
        </Button>
        {narrowing && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        )}
      </div>

      <div
        id="lead-filter-panel"
        className={cn(open ? "grid grid-cols-2 gap-2" : "hidden", "md:flex md:flex-wrap md:items-center md:gap-2")}
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
            className="md:w-44"
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
    </div>
  );
}
