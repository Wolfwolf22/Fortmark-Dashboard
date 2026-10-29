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
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, ChevronsUpDown, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const MOBILE_ORDERS: { value: `${SortKey}:${SortDir}`; label: string }[] = [
  { value: "followUp:asc", label: "Follow-up · earliest first" },
  { value: "followUp:desc", label: "Follow-up · latest first" },
  { value: "lastTouch:desc", label: "Last touch · newest first" },
  { value: "lastTouch:asc", label: "Last touch · oldest first" },
  { value: "name:asc", label: "Name · A–Z" },
  { value: "name:desc", label: "Name · Z–A" },
  { value: "stage:asc", label: "Stage · first to last" },
  { value: "stage:desc", label: "Stage · last to first" },
  { value: "created:desc", label: "Added · newest first" },
  { value: "created:asc", label: "Added · oldest first" },
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
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium tabular">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {followUpLabel(followUp)}
        </span>
      ) : (
        <span className="text-muted-foreground" aria-label="No follow-up scheduled">—</span>
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
    <Card className="min-w-0 overflow-hidden p-4 sm:p-5" aria-busy>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-36 max-w-full" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-20 shrink-0 rounded-full sm:block" />
          </div>
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
  onOrderChange,
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
  onOrderChange: (key: SortKey, dir: SortDir) => void;
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
      <Card className="min-w-0 p-5" role="alert">
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
  // The page replaces an out-of-range URL and requests the valid page. Do not
  // briefly claim a backwards range such as "51–1 of 1" during that recovery.
  if (current > maxPage) return <TableSkeleton />;
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <Card aria-busy={loading} className="min-w-0 overflow-hidden p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconWell icon={Users} />
          <div>
            <p role="status" aria-live="polite" className="text-sm font-semibold leading-snug tabular">
              {total === 1 ? "1 contact" : `${total} contacts`}
              {loading && <span className="ml-2 text-xs font-normal text-muted-foreground">Refreshing…</span>}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Open a contact to review details and follow-ups.</p>
          </div>
        </div>
        {!wide && (
          <Select value={`${sort}:${dir}`} onValueChange={(value) => {
            const [key, direction] = value.split(":") as [SortKey, SortDir];
            onOrderChange(key, direction);
          }}>
            <SelectTrigger className="h-11 w-full min-w-0 text-[13px] sm:w-64" aria-label="Sort contacts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              {MOBILE_ORDERS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {failed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border bg-tint px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">Could not refresh. Showing the last loaded contacts.</p>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      )}
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
        <Table className="min-w-[1060px]" containerClassName="max-h-[70vh] overflow-y-auto">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((col) => {
                const stick = "sticky top-0 z-10 border-b border-border bg-card";
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
                        "text-micro inline-flex min-h-10 items-center gap-1 rounded-sm transition-colors duration-150 hover:text-foreground",
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
                <TableRow key={lead.id} onClick={() => onOpen(lead.id)} className="group cursor-pointer" data-testid="lead-row">
                  <TableCell className="min-w-[225px] py-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 rounded-lg" aria-hidden>
                        <AvatarFallback className="rounded-lg bg-tint text-xs font-semibold text-foreground">{initials(lead.name)}</AvatarFallback>
                      </Avatar>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(lead.id);
                      }}
                      className="min-w-0 rounded-sm text-left leading-snug"
                    >
                      <span className="block max-w-[17rem] break-words text-[14px] font-semibold group-hover:underline">{lead.name}</span>
                      <span className="mt-1 block max-w-[17rem] break-all text-xs leading-relaxed text-muted-foreground">{lead.email || lead.phone || "No email or phone"}</span>
                    </button>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {lead.intent === "other" ? "—" : INTENT_LABELS[lead.intent]}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone="neutral">{LEAD_STAGE_LABELS[lead.stage]}</StatusPill>
                  </TableCell>
                  <TableCell>
                    <span className="whitespace-nowrap text-muted-foreground">{LEAD_SOURCE_LABELS[lead.source]}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {/* No avatar for a placeholder: its initials would be a made-up person. */}
                      {agent !== "Unnamed agent" && agent !== "—" && (
                        <Avatar className="h-6 w-6" aria-hidden>
                          <AvatarFallback className="bg-tint text-[9px] font-semibold text-foreground">{initials(agent)}</AvatarFallback>
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
                      variant="ghost"
                      size="sm"
                      aria-label={`Open ${lead.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(lead.id);
                      }}
                    >
                      Open
                      <ArrowUpRight aria-hidden />
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
                  className="flex w-full min-w-0 flex-col gap-3 rounded-panel px-1 py-4 text-left transition-colors duration-150 hover:bg-tint"
                >
                  <span className="flex w-full min-w-0 items-start gap-3">
                    <Avatar className="h-9 w-9 rounded-lg" aria-hidden>
                      <AvatarFallback className="rounded-lg bg-tint text-xs font-semibold text-foreground">{initials(lead.name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[15px] font-semibold leading-snug">{lead.name}</span>
                      <span className="mt-1 block break-all text-xs leading-relaxed text-muted-foreground">{lead.email || lead.phone || "No email or phone"}</span>
                    </span>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="neutral">{LEAD_STAGE_LABELS[lead.stage]}</StatusPill>
                    {lead.intent !== "other" && <span className="text-xs text-muted-foreground">{INTENT_LABELS[lead.intent]}</span>}
                  </span>
                  <span className="grid w-full min-w-0 grid-cols-1 gap-2 text-[13px] min-[430px]:grid-cols-2">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Follow-up</span>
                      <FollowUpCell lead={lead} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Last touch</span>
                      <LastTouchCell lead={lead} />
                    </span>
                  </span>
                  {showAgent && (
                    <span className="break-words text-xs leading-relaxed text-muted-foreground">
                      Assigned agent · {agent}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="tabular text-[13px] text-muted-foreground">
            Showing {first}–{last} of {total}
          </p>
          <nav aria-label="Pagination" className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => onPage(current - 1)} disabled={loading || current <= 1}>
              Previous
            </Button>
            <span className="tabular text-[13px] text-muted-foreground">
              Page {current} of {maxPage}
            </span>
            <Button variant="outline" size="sm" onClick={() => onPage(current + 1)} disabled={loading || current >= maxPage}>
              Next
            </Button>
          </nav>
        </div>
      )}
    </Card>
  );
}
