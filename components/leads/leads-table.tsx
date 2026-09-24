"use client";

/**
 * Leads table — sortable by name, budget, and last contact; 12-row pages.
 * A row click opens the lead drawer.
 *
 * "Follow-up" is the stored reminder, due by the same rule Home's Needs
 * attention queue uses. "No touch in 14 days" is a separate heuristic on
 * last contact, labelled as exactly that.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Agent,
  Lead,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
} from "@/lib/data/types";
import { cn, formatCurrencyCompact, formatRelative, initials } from "@/lib/utils";
import {
  followUpLabel,
  followUpStatus,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "@/lib/contacts/follow-up";
import { INTENT_LABELS, lastName } from "./lead-shared";

const PAGE_SIZE = 12;

type SortKey = "name" | "budget" | "lastContact" | "followUp";
type SortDir = "asc" | "desc";

const COLUMNS: {
  id: string;
  label: string;
  sortKey?: SortKey;
  align?: "right";
}[] = [
  { id: "name", label: "Name", sortKey: "name" },
  { id: "source", label: "Source" },
  { id: "intent", label: "Intent" },
  { id: "budget", label: "Budget", sortKey: "budget", align: "right" },
  { id: "neighborhood", label: "Neighborhood" },
  { id: "agent", label: "Agent" },
  { id: "stage", label: "Stage" },
  { id: "followUp", label: "Follow-up", sortKey: "followUp" },
  { id: "lastContact", label: "Last contact", sortKey: "lastContact" },
];

function sortValue(lead: Lead, key: SortKey): string | number {
  switch (key) {
    case "name":
      return lead.name.toLowerCase();
    case "budget":
      return lead.budget ?? -1;
    case "lastContact":
      return new Date(lead.lastContactDate).getTime();
    case "followUp":
      // Soonest first when ascending; none set sorts last.
      return lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).getTime() : Number.MAX_SAFE_INTEGER;
  }
}

function TableSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-4 h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function LeadsTable({
  leads,
  agents,
  loading,
  hasFilters,
  onClearFilters,
  onOpen,
}: {
  leads: Lead[] | undefined;
  agents: Pick<Agent, "id" | "name">[] | undefined;
  loading: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("lastContact");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const agentById = useMemo(
    () => new Map((agents ?? []).map((a) => [a.id, a])),
    [agents]
  );

  const rows = useMemo(() => {
    const list = leads ? [...leads] : [];
    list.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [leads, sortKey, sortDir]);

  if (!leads) return <TableSkeleton />;

  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, maxPage);
  const start = (current - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "lastContact" ? "desc" : "asc");
    }
    setPage(1);
  }

  return (
    <Card aria-busy={loading} className="p-6">
      <p className="tabular mb-4 text-[13px] text-muted-foreground">
        {total === 1 ? "1 lead" : `${total} leads`}
      </p>
      {total === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads match"
          description="Clear the stage chip or filters, or add a lead from quick create."
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((col) => {
                  if (!col.sortKey) {
                    return (
                      <TableHead
                        key={col.id}
                        className={col.align === "right" ? "text-right" : undefined}
                      >
                        {col.label}
                      </TableHead>
                    );
                  }
                  const active = sortKey === col.sortKey;
                  return (
                    <TableHead
                      key={col.id}
                      aria-sort={
                        active
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={col.align === "right" ? "text-right" : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
                        className={cn(
                          "text-micro inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground",
                          active && "text-foreground"
                        )}
                      >
                        {col.label}
                        {active ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        )}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((lead) => {
                const agentName =
                  lead.assignedAgentName ?? agentById.get(lead.assignedAgentId)?.name;
                const followUp = followUpStatus(lead.nextFollowUpDate);
                const quiet = noRecentTouch(lead.lastContactDate);
                return (
                  <TableRow
                    key={lead.id}
                    onClick={() => onOpen(lead.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(lead.id);
                        }}
                        className="text-left leading-snug"
                      >
                        <span className="block font-semibold hover:underline">
                          {lead.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {lead.email}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {LEAD_SOURCE_LABELS[lead.source]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {INTENT_LABELS[lead.intent]}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {lead.budget != null
                        ? formatCurrencyCompact(lead.budget)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.neighborhood ?? "—"}
                    </TableCell>
                    <TableCell>
                      {agentName ? (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[9px]">
                              {initials(agentName)}
                            </AvatarFallback>
                          </Avatar>
                          {lastName(agentName)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {LEAD_STAGE_LABELS[lead.stage]}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid="lead-follow-up-cell">
                      {isFollowUpDue(followUp) ? (
                        <StatusPill tone="warn">{followUpLabel(followUp)}</StatusPill>
                      ) : followUp.state === "scheduled" ? (
                        <span className="tabular whitespace-nowrap">{followUpLabel(followUp)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {quiet ? (
                        <StatusPill tone="neutral">{NO_TOUCH_LABEL}</StatusPill>
                      ) : (
                        <span className="tabular text-muted-foreground">
                          {formatRelative(lead.lastContactDate)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="tabular text-[13px] text-muted-foreground">
              Showing {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(current - 1)}
                disabled={current <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= maxPage}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
