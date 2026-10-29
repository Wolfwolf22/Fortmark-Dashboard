"use client";

/**
 * Transactions kanban — one column per stage in pipeline order. Drag a card
 * into another column to move its stage (optimistic, then persisted through
 * the adapter). Click a card — or focus it and press Enter — to open the
 * detail drawer; Space picks a card up for keyboard dragging.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Building2, CalendarDays, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { updateTransactionStage } from "@/lib/data/adapters/transactions";
import { bumpDataVersion } from "@/lib/data/store";
import {
  Transaction,
  TransactionStage,
  TRANSACTION_STAGES,
  TRANSACTION_STAGE_LABELS,
} from "@/lib/data/types";
import {
  cn,
  formatCurrency,
  formatCurrencyCompact,
  formatDateShort,
} from "@/lib/utils";
import { closeCountdown, SIDE_SHORT } from "./txn-shared";
import { TransactionProgress } from "./transaction-progress";
import { isActiveStage } from "@/lib/transactions/stages";

interface KanbanBoardProps {
  transactions: Transaction[] | undefined;
  loading: boolean;
  onOpen: (id: string) => void;
}

function CardBody({ txn }: { txn: Transaction }) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <IconWell icon={Building2} />
        <Badge variant="muted">{SIDE_SHORT[txn.side]}</Badge>
      </div>
      <p className="break-words text-[14px] font-semibold leading-snug">{txn.address}</p>
      <p className="mt-1 break-words text-xs text-muted-foreground">{txn.city}</p>
      <p className="mt-3 break-words text-xs text-muted-foreground">Client <span className="ml-1 font-medium text-foreground">{txn.clientName}</span></p>
      <p className="tabular mt-3 text-xl font-bold tracking-tight">
        {formatCurrency(txn.contractPrice)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Contract price</p>
      <div className="my-3 border-t border-border pt-3">
        <TransactionProgress stage={txn.stage} compact />
      </div>
      <p className="tabular flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {txn.closeDate ? `${formatDateShort(txn.closeDate)} · ` : ""}{closeCountdown(txn)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <StatusPill tone={isActiveStage(txn.stage) ? txn.status : "neutral"}>{isActiveStage(txn.stage) ? txn.statusLabel : TRANSACTION_STAGE_LABELS[txn.stage]}</StatusPill>
      </div>
    </>
  );
}

function DraggableCard({
  txn,
  onOpen,
  dragHappened,
}: {
  txn: Transaction;
  onOpen: (id: string) => void;
  dragHappened: MutableRefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: txn.id,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Open transaction ${txn.address}. Current stage: ${TRANSACTION_STAGE_LABELS[txn.stage]}.`}
      onClick={() => {
        // Suppress the click the browser fires right after a drag ends.
        if (!dragHappened.current) onOpen(txn.id);
      }}
      className={cn(
        "w-full cursor-grab touch-none rounded-panel border border-border bg-card p-4 text-left shadow-card transition-shadow duration-150 hover:shadow-card-hover active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <CardBody txn={txn} />
    </button>
  );
}

function Column({
  stage,
  items,
  onOpen,
  dragHappened,
}: {
  stage: TransactionStage;
  items: Transaction[];
  onOpen: (id: string) => void;
  dragHappened: MutableRefObject<boolean>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const sum = items.reduce((acc, t) => acc + t.contractPrice, 0);
  return (
    <section
      aria-label={`${TRANSACTION_STAGE_LABELS[stage]} column`}
      className="flex w-[264px] flex-none flex-col gap-3 sm:w-[288px]"
    >
      <div className="flex items-baseline justify-between px-1">
        <p className="flex items-baseline gap-1.5">
          <span className="text-micro">{TRANSACTION_STAGE_LABELS[stage]}</span>
          <span className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-tint px-1 text-[11px] font-semibold text-muted-foreground">
            {items.length}
          </span>
        </p>
        <span className="tabular text-xs text-muted-foreground">
          {items.length ? formatCurrencyCompact(sum) : "—"}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[220px] flex-1 flex-col gap-3 rounded-card border border-border bg-tint p-2",
          isOver && "ring-1 ring-ring"
        )}
      >
        {items.map((t) => (
          <DraggableCard
            key={t.id}
            txn={t}
            onOpen={onOpen}
            dragHappened={dragHappened}
          />
        ))}
        {items.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No deals in this stage
          </p>
        )}
      </div>
    </section>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex items-stretch gap-4 overflow-x-auto pb-4">
      {TRANSACTION_STAGES.map((stage, i) => (
        <div key={stage} className="flex w-[280px] flex-none flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="flex flex-col gap-2 rounded-panel bg-tint p-2">
            {Array.from({ length: (i % 3) + 1 }).map((_, j) => (
              <Skeleton key={j} className="h-28 w-full rounded-panel bg-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KanbanBoard({ transactions, loading, onOpen }: KanbanBoardProps) {
  // Optimistic stage overrides so a dropped card lands instantly; cleared
  // whenever fresh adapter data arrives (the refetch carries the truth).
  const [overrides, setOverrides] = useState<Record<string, TransactionStage>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const dragHappened = useRef(false);

  useEffect(() => {
    setOverrides({});
  }, [transactions]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      // Space starts a keyboard drag so Enter stays free to open the drawer.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    })
  );

  const byStage = useMemo(() => {
    const map = Object.fromEntries(
      TRANSACTION_STAGES.map((s) => [s, [] as Transaction[]])
    ) as Record<TransactionStage, Transaction[]>;
    for (const t of transactions ?? []) {
      // Exited and on-hold deals are not pipeline columns; the table shows
      // them. Bucketing them here would index a column that does not exist.
      const column = overrides[t.id] ?? t.stage;
      if (column in map) map[column].push(t);
    }
    return map;
  }, [transactions, overrides]);

  if (!transactions) return loading ? <BoardSkeleton /> : (
    <EmptyState icon={Inbox} title="Transactions could not be loaded" description="Refresh the page to try again." />
  );

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No transactions found"
        description="Clear the search or the side filter to see every file, or add a transaction from Create."
      />
    );
  }

  const activeTxn = activeId
    ? transactions.find((t) => t.id === activeId)
    : undefined;

  function handleDragStart(event: DragStartEvent) {
    setMoveError(null);
    dragHappened.current = true;
    setActiveId(String(event.active.id));
  }

  function endDrag() {
    setActiveId(null);
    // Clear after the post-drop click has already been dispatched.
    window.setTimeout(() => {
      dragHappened.current = false;
    }, 0);
  }

  function handleDragEnd(event: DragEndEvent) {
    endDrag();
    const { active, over } = event;
    if (!over || !transactions) return;
    const target = over.id as TransactionStage;
    const txn = transactions.find((t) => t.id === active.id);
    if (!txn) return;
    const current = overrides[txn.id] ?? txn.stage;
    if (target === current) return;
    setOverrides((prev) => ({ ...prev, [txn.id]: target }));
    // A move the lifecycle refuses throws; a refetch drops the optimistic
    // override and the card returns to where the deal actually is.
    void updateTransactionStage(txn.id, target).catch(() => {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[txn.id];
        return next;
      });
      setMoveError("The stage change could not be confirmed. Reloading the recorded stage. Open the file to check before trying again.");
      bumpDataVersion();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      {moveError && <p role="alert" className="mb-3 rounded-panel border border-border bg-tint px-4 py-3 text-sm">{moveError}</p>}
      <div
        aria-busy={loading}
        className="flex items-stretch gap-4 overflow-x-auto pb-4"
      >
        {TRANSACTION_STAGES.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            items={byStage[stage]}
            onOpen={onOpen}
            dragHappened={dragHappened}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTxn ? (
          <div className="w-[248px] rounded-panel border border-border bg-card p-4 shadow-pop sm:w-[272px]">
            <CardBody txn={activeTxn} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
