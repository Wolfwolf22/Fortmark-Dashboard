"use client";

/**
 * Leads — pipeline summary strip, filterable table, and a detail drawer
 * with stage advancement. ?open=<leadId> deep-links into the drawer.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { LeadDrawer } from "@/components/leads/lead-drawer";
import { LeadsTable } from "@/components/leads/leads-table";
import { PipelineSummary } from "@/components/leads/pipeline-summary";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgents } from "@/lib/data/adapters/agents";
import { getLeads } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  LeadSource,
  LeadStage,
} from "@/lib/data/types";

type SourceFilter = "all" | LeadSource;

const SOURCES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-hidden pb-1">
        {LEAD_STAGES.map((stage) => (
          <Skeleton key={stage} className="h-[4.5rem] w-28 flex-none rounded-panel" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      <Skeleton className="h-96 w-full rounded-card" />
    </div>
  );
}

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [agentId, setAgentId] = useState<string>("all");
  const [stage, setStage] = useState<LeadStage | null>(null);

  const openParam = searchParams.get("open");
  const [drawerId, setDrawerId] = useState<string | null>(openParam);
  const [drawerOpen, setDrawerOpen] = useState(openParam !== null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  // Deep link: /leads?open=<leadId> opens the drawer on load (and on any
  // later navigation that sets the param).
  useEffect(() => {
    if (openParam) {
      setDrawerId(openParam);
      setDrawerOpen(true);
    }
  }, [openParam]);

  // One query without the stage filter: the table slices it client-side so
  // the summary strip always shows counts for the current search scope.
  const { data: leads, loading } = useQuery(
    () =>
      getLeads({
        query: debouncedSearch || undefined,
        source: source === "all" ? undefined : [source],
        agentId: agentId === "all" ? undefined : agentId,
      }),
    [debouncedSearch, source, agentId]
  );

  const { data: agents } = useQuery(() => getAgents(), []);

  const counts = useMemo(() => {
    if (!leads) return undefined;
    const result = Object.fromEntries(
      LEAD_STAGES.map((s) => [s, 0])
    ) as Record<LeadStage, number>;
    for (const lead of leads) result[lead.stage] += 1;
    return result;
  }, [leads]);

  const visible = useMemo(
    () => (stage && leads ? leads.filter((l) => l.stage === stage) : leads),
    [leads, stage]
  );

  const hasFilters =
    debouncedSearch !== "" || source !== "all" || agentId !== "all" || stage !== null;

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setSource("all");
    setAgentId("all");
    setStage(null);
  }

  function openLead(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  function handleDrawerOpenChange(nextOpen: boolean) {
    setDrawerOpen(nextOpen);
    // Drop the deep-link param on close so a refresh does not reopen it.
    if (!nextOpen && searchParams.get("open")) {
      router.replace("/leads", { scroll: false });
    }
  }

  return (
    <div className="space-y-5">
      <PipelineSummary
        counts={counts}
        activeStage={stage}
        onToggle={(s) => setStage((prev) => (prev === s ? null : s))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or neighborhood"
            aria-label="Search leads"
            className="pl-9"
          />
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger aria-label="Filter by source" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger aria-label="Filter by agent" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <LeadsTable
        leads={visible}
        agents={agents}
        loading={loading}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
        onOpen={openLead}
      />
      <LeadDrawer
        leadId={drawerId}
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadsPageInner />
    </Suspense>
  );
}
