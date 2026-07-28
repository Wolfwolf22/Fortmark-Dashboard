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
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { updateTransactionStage } from "@/lib/data/adapters/transactions";
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

interface KanbanBoardProps {
  transactions: Transaction[] | undefined;
  loading: boolean;
  onOpen: (id: string) => void;
}

function CardBody({ txn }: { txn: Transaction }) {
  return (
    <>
      <p className="text-[13px] font-semibold leading-snug">{txn.address}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{txn.clientName}</p>
      <p className="tabular mt-2.5 text-sm font-semibold">
        {formatCurrency(txn.contractPrice)}
      </p>
      <p className="tabular mt-0.5 text-xs text-muted-foreground">
        {formatDateShort(txn.closeDate)} · {closeCountdown(txn)}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <StatusPill tone={txn.status}>{txn.statusLabel}</StatusPill>
        <Badge variant="outline">{SIDE_SHORT[txn.side]}</Badge>
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
      onClick={() => {
        // Suppress the click the browser fires right after a drag ends.
        if (!dragHappened.current) onOpen(txn.id);
      }}
      className={cn(
        "w-full cursor-grab touch-none rounded-panel border border-border bg-card p-3 text-left transition-shadow duration-150 hover:shadow-card active:cursor-grabbing",
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
      className="flex w-[280px] flex-none flex-col gap-2"
    >
      <div className="flex items-baseline justify-between px-1">
        <p className="flex items-baseline gap-1.5">
          <span className="text-micro">{TRANSACTION_STAGE_LABELS[stage]}</span>
          <span className="tabular text-xs font-semibold text-muted-foreground">
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
          "flex min-h-[180px] flex-1 flex-col gap-2 rounded-panel bg-tint p-2",
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
      map[overrides[t.id] ?? t.stage].push(t);
    }
    return map;
  }, [transactions, overrides]);

  if (!transactions) return <BoardSkeleton />;

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No transactions in this period"
        description="Widen the date range or clear the search to see active files."
      />
    );
  }

  const activeTxn = activeId
    ? transactions.find((t) => t.id === activeId)
    : undefined;

  function handleDragStart(event: DragStartEvent) {
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
    void updateTransactionStage(txn.id, target);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
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
          <div className="w-[264px] rounded-panel border border-border bg-card p-3 shadow-pop">
            <CardBody txn={activeTxn} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
