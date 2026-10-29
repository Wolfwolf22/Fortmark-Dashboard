"use client";

/**
 * Contacts — the daily CRM workspace. A person stays here from first touch through
 * representation, a transaction and beyond; "lead" is one stage of that, not the section.
 *
 * A snapshot of what needs attention, quick views over the same contacts, a
 * filter bar, and one dense table. Every filter, sort and page is a request to
 * the server; the page keeps no copy of the list to narrow. The filters live in
 * the URL (`/contacts?followUp=overdue&active=1`) so a refresh, the back button and
 * a link to a colleague all land on the same view. Search text does not: it can
 * be a client's name, number or email, and a URL is logged.
 *
 * `?open=<leadId>` deep-links into the drawer.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
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
import { contactPageWithinRange, contactWorkspaceRequest, nextContactRefreshDelay } from "@/lib/contacts/workspace";

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

/** Refresh on return, business midnight and minute boundaries for timed actions. */
function useContactRefreshKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      setKey((current) => current + 1);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { refresh(); schedule(); }, nextContactRefreshDelay(new Date(), true));
    };
    const resume = () => { refresh(); schedule(); };
    schedule();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return key;
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <PageIntro icon={Users} title="Contacts" description="Manage relationships, follow-ups, and activity." />
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
    return { title: "No contacts yet", description: "Add a contact with New contact to start your book." };
  }
  const view = matchingView(query);
  if (view === "overdue") return { title: "No overdue follow-ups", description: "No overdue reminders match these filters." };
  if (view === "due_today") return { title: "No follow-ups due today", description: "No reminders for today match these filters." };
  if (query.followUp === "upcoming") return { title: "No upcoming follow-ups", description: "No future reminders match these filters." };
  if (view === "no_touch_14") return { title: "Nobody has gone quiet", description: "Contacts without a recent recorded touch will appear here." };
  return { title: "No contacts match these filters", description: "Clear a filter or try a different search." };
}

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);
  const abilities = leadAbilities(useSessionUser().role);

  const urlKey = searchParams.toString();
  const filters = useMemo(() => readQuery(new URLSearchParams(urlKey)), [urlKey]);
  const openParam = searchParams.get("open");
  const refreshKey = useContactRefreshKey();

  // The filters as of the last thing the person did. The URL is the source of truth, but it
  // lands a moment after a click; a second click in that moment must build on the first, not
  // on the stale render, or a quick "clear, then sort" would quietly bring the filter back.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [resetSearchPage, setResetSearchPage] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (resetSearchPage && (filters.page ?? 1) <= 1) setResetSearchPage(false);
  }, [filters.page, resetSearchPage]);

  const searchPending = search.trim() !== debounced;
  const request = contactWorkspaceRequest(filters, debounced, PAGE_SIZE, resetSearchPage || searchPending);
  const order = { sort: request.sort, dir: request.dir };
  const requestKey = JSON.stringify(request);

  const list = useQuery(async () => ({ result: await getLeadsPage(request), requestKey }), [requestKey, refreshKey]);
  const snapshot = useQuery(() => getLeadSnapshot(), [refreshKey]);
  const agents = useQuery(() => getLeadAgents(), [refreshKey]);

  const [lastDrawerId, setLastDrawerId] = useState<string | null>(openParam);
  useEffect(() => {
    if (openParam) setLastDrawerId(openParam);
  }, [openParam]);
  const drawerId = openParam ?? lastDrawerId;
  const drawerOpen = openParam !== null;

  /** Write the filters to the URL. `open` (the drawer) is preserved. */
  function navigate(next: ContactQuery, mode: "push" | "replace" = "push", drawer: string | null = openParam) {
    latest.current = next;
    const fields = queryFields({ ...next, q: undefined, pageSize: undefined, page: next.page && next.page > 1 ? next.page : undefined });
    const sp = new URLSearchParams(fields);
    const open = drawer;
    if (open) sp.set("open", open);
    const qs = sp.toString();
    // A push, so back and forward step through the views a person has visited.
    const href = qs ? `/contacts?${qs}` : "/contacts";
    if (mode === "replace") router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }

  useEffect(() => {
    // An old query's response must never move a newer view to its page.
    if (list.loading || list.error || !list.data || list.data.requestKey !== requestKey || resetSearchPage || searchPending) return;
    const result = list.data.result;
    const page = contactPageWithinRange(result.page, result.total, result.pageSize);
    if ((filters.page ?? 1) !== page) navigate({ ...latest.current, page: page > 1 ? page : undefined }, "replace");
    // navigate uses the latest URL and filter ref; requestKey identifies the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.loading, list.error, requestKey, filters.page, resetSearchPage, searchPending]);

  function changeSearch(text: string) {
    setSearch(text);
    setResetSearchPage(true);
    // Reset immediately, before either debounce or router navigation settles.
    navigate({ ...latest.current, page: undefined }, "replace");
  }

  const change = (patch: Partial<ContactQuery>) => {
    const next: ContactQuery = { ...latest.current, ...patch, page: undefined };
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
    navigate({ ...latest.current, sort: key, dir, page: undefined });
  };
  const goToPage = (n: number) => navigate({ ...latest.current, page: n });
  const changeOrder = (sort: SortKey, dir: SortDir) => navigate({ ...latest.current, sort, dir, page: undefined });

  function handleDrawerOpenChange(nextOpen: boolean) {
    // Drop the deep-link param on close so a refresh does not reopen it, and keep the filters.
    if (!nextOpen && searchParams.get("open")) {
      navigate({ ...latest.current }, "replace", null);
    }
  }

  const narrowing = Boolean(debounced) || Object.keys(filters).some((k) => !["sort", "dir", "page"].includes(k));

  return (
    <div className="space-y-4">
      <PageIntro icon={Users} title="Contacts" description="Manage relationships, follow-ups, and activity." action={abilities.canWrite ? (
          <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => setQuickCreate("lead")}>
            <Plus aria-hidden />
            New contact
          </Button>
        ) : undefined} />

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
        onSearch={changeSearch}
        onChange={change}
        onApplyView={applyView}
        onClear={clear}
        agents={agents.data ?? []}
        stageCounts={snapshot.data?.byStage}
        brokerageWide={abilities.sees === "brokerage"}
      />

      <LeadsTable
        page={list.data?.result}
        loading={list.loading || searchPending || resetSearchPage || list.data?.requestKey !== requestKey}
        failed={Boolean(list.error)}
        onRetry={list.refetch}
        sort={order.sort}
        dir={order.dir}
        onSort={sortBy}
        onOrderChange={changeOrder}
        onPage={goToPage}
        hasFilters={narrowing}
        onClearFilters={clear}
        empty={emptyCopy(filters, narrowing)}
        onOpen={(id) => navigate({ ...latest.current }, "push", id)}
        agents={agents.data ?? []}
        showAgent={abilities.sees === "brokerage"}
      />

      <LeadDrawer leadId={drawerId} open={drawerOpen} onOpenChange={handleDrawerOpenChange} refreshKey={refreshKey} />
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
