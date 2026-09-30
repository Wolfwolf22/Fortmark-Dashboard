"use client";

/**
 * The Contacts table — dense, sortable, paged by the server.
 *
 * Nothing here filters, sorts or pages data: the page asks the server for one
 * page in one order and this component draws it. Sorting is a request, not a
 * client-side reorder of what happened to arrive.
 *
 * "Follow-up" is the stored reminder, due by the same rule Home's Needs
 * attention queue uses. "No touch in 14 days" is a separate heuristic on last
 * contact, labelled as exactly that. A person never touched reads "Never".
 *
 * Below 768px the same page of rows is drawn as a compact list instead of
 * squeezing a nine-column table: name, stage, next follow-up, last touch and
 * (for a brokerage-wide role) the agent, one tap to open.
 */
import { ArrowDown, ArrowUp, ChevronsUpDown, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadPage } from "@/lib/data/adapters/leads";
import { Lead, LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/data/types";
import { cn, formatDate, formatRelative, initials } from "@/lib/utils";
import {
  followUpLabel,
  followUpStatus,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "@/lib/contacts/follow-up";
import type { SortDir, SortKey } from "@/lib/contacts/filters";
import { INTENT_LABELS, useMinWidth } from "./lead-shared";

interface Column {
  id: string;
  label: string;
  sortKey?: SortKey;
}

const COLUMNS: Column[] = [
  { id: "name", label: "Name", sortKey: "name" },
  { id: "intent", label: "Intent" },
  { id: "stage", label: "Stage", sortKey: "stage" },
  { id: "source", label: "Source" },
  { id: "agent", label: "Assigned agent" },
  { id: "lastTouch", label: "Last touch", sortKey: "lastTouch" },
  { id: "followUp", label: "Next follow-up", sortKey: "followUp" },
  { id: "created", label: "Created", sortKey: "created" },
  { id: "actions", label: "Actions" },
];

/** The agent as the screen names them. Never an id, never an email. */
export function agentLabel(lead: Lead, byId: Map<string, string>): string {
  return lead.assignedAgentName ?? byId.get(lead.assignedAgentId) ?? (lead.recordSource === "sample" ? "—" : "Unnamed agent");
}

function FollowUpCell({ lead }: { lead: Lead }) {
  const followUp = followUpStatus(lead.nextFollowUpDate);
  return (
    <span data-testid="lead-follow-up-cell">
      {isFollowUpDue(followUp) ? (
        <StatusPill tone="warn">{followUpLabel(followUp)}</StatusPill>
      ) : followUp.state === "future" ? (
        <span className="tabular whitespace-nowrap">{followUpLabel(followUp)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </span>
  );
}

function LastTouchCell({ lead }: { lead: Lead }) {
  const quiet = noRecentTouch(lead.lastContactDate);
  if (quiet) return <StatusPill tone="neutral">{NO_TOUCH_LABEL}</StatusPill>;
  return (
    <span className="tabular text-muted-foreground">
      {lead.lastTouchDate || lead.recordSource === "sample" ? formatRelative(lead.lastContactDate) : "Never"}
    </span>
  );
}

function TableSkeleton() {
  return (
    <Card className="p-6" aria-busy>
      <Skeleton className="mb-4 h-4 w-24" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function LeadsTable({
  page,
  loading,
  failed,
  onRetry,
  sort,
  dir,
  onSort,
  onPage,
  hasFilters,
  onClearFilters,
  empty,
  onOpen,
  agents,
  showAgent,
}: {
  page: LeadPage | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  onPage: (page: number) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  empty: { title: string; description: string };
  onOpen: (id: string) => void;
  agents: { id: string; name: string }[];
  showAgent: boolean;
}) {
  const wide = useMinWidth(768);
  const byId = new Map(agents.map((a) => [a.id, a.name]));

  if (!page && failed) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Users}
          title="Contacts could not be loaded"
          description="Something went wrong reaching your contacts. Nothing has been changed."
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }
  if (!page) return <TableSkeleton />;

  const { items, total, pageSize } = page;
  const current = page.page;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <Card aria-busy={loading} className={cn("p-4 md:p-6", loading && "opacity-80 transition-opacity")}>
      <p role="status" aria-live="polite" className="tabular mb-3 text-[13px] text-muted-foreground">
        {total === 1 ? "1 contact" : `${total} contacts`}
        {failed && " · could not refresh"}
      </p>
      {total === 0 ? (
        <EmptyState
          icon={Users}
          title={empty.title}
          description={empty.description}
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : wide ? (
        <Table containerClassName="max-h-[70vh] overflow-y-auto">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((col) => {
                const stick = "sticky top-0 z-10 bg-card";
                if (!col.sortKey) {
                  return (
                    <TableHead key={col.id} className={stick}>
                      {col.label}
                    </TableHead>
                  );
                }
                const active = sort === col.sortKey;
                return (
                  <TableHead
                    key={col.id}
                    className={stick}
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey!)}
                      className={cn(
                        "text-micro inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active && "text-foreground"
                      )}
                    >
                      {col.label}
                      {active ? (
                        dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
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
            {items.map((lead) => {
              const agent = agentLabel(lead, byId);
              return (
                <TableRow key={lead.id} onClick={() => onOpen(lead.id)} className="cursor-pointer" data-testid="lead-row">
                  <TableCell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(lead.id);
                      }}
                      className="text-left leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block font-semibold hover:underline">{lead.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{lead.email || lead.phone || " "}</span>
                    </button>
                  </TableCell>
                  <TableCell className={cn(lead.intent === "other" ? "text-muted-foreground/70" : "text-muted-foreground")}>
                    {lead.intent === "other" ? "—" : INTENT_LABELS[lead.intent]}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{LEAD_STAGE_LABELS[lead.stage]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{LEAD_SOURCE_LABELS[lead.source]}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {/* No avatar for a placeholder: its initials would be a made-up person. */}
                      {agent !== "Unnamed agent" && agent !== "—" && (
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px]">{initials(agent)}</AvatarFallback>
                        </Avatar>
                      )}
                      <span className={cn((agent === "Unnamed agent" || agent === "—") && "text-muted-foreground")}>{agent}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <LastTouchCell lead={lead} />
                  </TableCell>
                  <TableCell>
                    <FollowUpCell lead={lead} />
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(lead.createdDate)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Open ${lead.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(lead.id);
                      }}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <ul className="-mx-1 divide-y divide-border" aria-label="Contacts">
          {items.map((lead) => {
            const agent = agentLabel(lead, byId);
            return (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => onOpen(lead.id)}
                  data-testid="lead-row"
                  className="flex w-full flex-col gap-1.5 px-1 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-semibold leading-snug">{lead.name}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {LEAD_STAGE_LABELS[lead.stage]}
                    </Badge>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Follow-up</span>
                      <FollowUpCell lead={lead} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Last touch</span>
                      <LastTouchCell lead={lead} />
                    </span>
                  </span>
                  {showAgent && (
                    <span className={cn("text-xs", agent === "Unnamed agent" ? "text-muted-foreground" : "text-muted-foreground")}>
                      {agent}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="tabular text-[13px] text-muted-foreground">
            Showing {first}–{last} of {total}
          </p>
          <nav aria-label="Pagination" className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onPage(current - 1)} disabled={current <= 1}>
              Previous
            </Button>
            <span className="tabular text-[13px] text-muted-foreground">
              Page {current} of {maxPage}
            </span>
            <Button variant="outline" size="sm" onClick={() => onPage(current + 1)} disabled={current >= maxPage}>
              Next
            </Button>
          </nav>
        </div>
      )}
    </Card>
  );
}
