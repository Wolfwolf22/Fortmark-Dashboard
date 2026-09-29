"use client";

/**
 * Leads — the daily CRM workspace.
 *
 * A snapshot of what needs attention, quick views over the same contacts, a
 * filter bar, and one dense table. Every filter, sort and page is a request to
 * the server; the page keeps no copy of the list to narrow. The filters live in
 * the URL (`/leads?followUp=overdue&active=1`) so a refresh, the back button and
 * a link to a colleague all land on the same view. Search text does not: it can
 * be a client's name, number or email, and a URL is logged.
 *
 * `?open=<leadId>` deep-links into the drawer.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useSessionUser } from "@/components/layout/session-user";
import { LeadDrawer } from "@/components/leads/lead-drawer";
import { leadAbilities } from "@/components/leads/lead-shared";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { LeadsSnapshotStrip } from "@/components/leads/leads-snapshot";
import { LeadsTable } from "@/components/leads/leads-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLeadAgents, getLeadSnapshot, getLeadsPage, queryFields } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import { matchingView, parseContactQuery, type ContactQuery, type SortDir, type SortKey } from "@/lib/contacts/filters";
import { useUiStore } from "@/lib/stores/ui";

const PAGE_SIZE = 25;

/** Read the filters out of the URL, dropping anything invalid rather than failing the page. */
function readQuery(params: URLSearchParams): ContactQuery {
  const get = (key: string) => (key === "q" || key === "pageSize" ? null : params.get(key));
  const first = parseContactQuery(get);
  if (first.ok) return first.query;
  const bad = new Set(first.fields);
  const second = parseContactQuery((key) => (bad.has(key) ? null : get(key)));
  return second.ok ? second.query : {};
}

/** How a view is ordered until someone chooses otherwise: the most urgent first. */
function defaultOrder(query: ContactQuery): { sort: SortKey; dir: SortDir } {
  if (query.followUp === "overdue" || query.followUp === "due_today") return { sort: "followUp", dir: "asc" };
  if (query.lastTouch === "14d" || query.lastTouch === "30d" || query.lastTouch === "7d") return { sort: "lastTouch", dir: "asc" };
  return { sort: "lastTouch", dir: "desc" };
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-40" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[3.75rem] rounded-panel" />
        ))}
      </div>
      <Skeleton className="h-9 w-full sm:w-80" />
      <Skeleton className="h-96 w-full rounded-card" />
    </div>
  );
}

function emptyCopy(query: ContactQuery, narrowing: boolean): { title: string; description: string } {
  if (!narrowing) {
    return { title: "No leads yet", description: "Add a lead with New lead to start your book." };
  }
  const view = matchingView(query);
  if (view === "overdue") return { title: "No overdue follow-ups", description: "Nothing you owe a call is past its day." };
  if (view === "due_today") return { title: "No follow-ups due today", description: "Nothing is scheduled for today." };
  if (view === "no_touch_14") return { title: "Nobody has gone quiet", description: "Every active lead has been touched in the last 14 days." };
  return { title: "No leads match these filters", description: "Clear a filter or try a different search." };
}

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);
  const abilities = leadAbilities(useSessionUser().role);

  const urlKey = searchParams.toString();
  const filters = useMemo(() => readQuery(new URLSearchParams(urlKey)), [urlKey]);
  const openParam = searchParams.get("open");

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const order = filters.sort ? { sort: filters.sort, dir: filters.dir ?? "asc" } : defaultOrder(filters);
  const request: ContactQuery = {
    ...filters,
    q: debounced || undefined,
    sort: order.sort,
    dir: order.dir,
    page: filters.page ?? 1,
    pageSize: PAGE_SIZE,
  };
  const requestKey = JSON.stringify(request);

  const list = useQuery(() => getLeadsPage(request), [requestKey]);
  const snapshot = useQuery(() => getLeadSnapshot(), []);
  const agents = useQuery(() => getLeadAgents(), []);

  const [drawerId, setDrawerId] = useState<string | null>(openParam);
  const [drawerOpen, setDrawerOpen] = useState(openParam !== null);
  useEffect(() => {
    if (openParam) {
      setDrawerId(openParam);
      setDrawerOpen(true);
    }
  }, [openParam]);

  /** Write the filters to the URL. `open` (the drawer) is preserved. */
  function navigate(next: ContactQuery) {
    const fields = queryFields({ ...next, pageSize: undefined, page: next.page && next.page > 1 ? next.page : undefined });
    const sp = new URLSearchParams(fields);
    const open = searchParams.get("open");
    if (open) sp.set("open", open);
    const qs = sp.toString();
    // A push, so back and forward step through the views a person has visited.
    router.push(qs ? `/leads?${qs}` : "/leads", { scroll: false });
  }

  const change = (patch: Partial<ContactQuery>) => {
    const next: ContactQuery = { ...filters, ...patch, page: undefined };
    for (const k of Object.keys(next) as (keyof ContactQuery)[]) if (next[k] === undefined) delete next[k];
    navigate(next);
  };
  const applyView = (viewFilters: ContactQuery) => navigate({ ...viewFilters });
  const clear = () => {
    setSearch("");
    setDebounced("");
    navigate({});
  };
  const sortBy = (key: SortKey) => {
    const dir: SortDir = key === order.sort ? (order.dir === "asc" ? "desc" : "asc") : key === "lastTouch" || key === "created" ? "desc" : "asc";
    navigate({ ...filters, sort: key, dir, page: undefined });
  };
  const goToPage = (n: number) => navigate({ ...filters, page: n });

  function handleDrawerOpenChange(nextOpen: boolean) {
    setDrawerOpen(nextOpen);
    // Drop the deep-link param on close so a refresh does not reopen it, and keep the filters.
    if (!nextOpen && searchParams.get("open")) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("open");
      const qs = sp.toString();
      router.replace(qs ? `/leads?${qs}` : "/leads", { scroll: false });
    }
  }

  const narrowing = Boolean(debounced) || Object.keys(filters).some((k) => !["sort", "dir", "page"].includes(k));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The section's one heading is the shell's (visually hidden); this is its visible title. */}
          <p aria-hidden className="text-display text-2xl">
            Leads
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Manage relationships, follow-ups and activity.</p>
        </div>
        {abilities.canWrite && (
          <Button type="button" onClick={() => setQuickCreate("lead")}>
            <Plus aria-hidden />
            New lead
          </Button>
        )}
      </div>

      <LeadsSnapshotStrip
        snapshot={snapshot.data}
        loading={snapshot.loading}
        failed={Boolean(snapshot.error)}
        current={filters}
        onApply={applyView}
      />

      <LeadsFilters
        query={filters}
        search={search}
        onSearch={setSearch}
        onChange={change}
        onApplyView={applyView}
        onClear={clear}
        agents={agents.data ?? []}
        stageCounts={snapshot.data?.byStage}
        brokerageWide={abilities.sees === "brokerage"}
      />

      <LeadsTable
        page={list.data}
        loading={list.loading}
        failed={Boolean(list.error)}
        onRetry={list.refetch}
        sort={order.sort}
        dir={order.dir}
        onSort={sortBy}
        onPage={goToPage}
        hasFilters={narrowing}
        onClearFilters={clear}
        empty={emptyCopy(filters, narrowing)}
        onOpen={(id) => {
          setDrawerId(id);
          setDrawerOpen(true);
        }}
        agents={agents.data ?? []}
        showAgent={abilities.sees === "brokerage"}
      />

      <LeadDrawer leadId={drawerId} open={drawerOpen} onOpenChange={handleDrawerOpenChange} />
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
