"use client";
import { useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, GripVertical, LayoutGrid, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionLayoutStore } from "@/lib/stores/transaction-layout";
import { defaultTransactionLayout, moveVisibleSection, SECTION_LABELS, type FileSectionId, type TransactionLayoutProfile } from "@/lib/transactions/layout-domain";
import { cn } from "@/lib/utils";

export type TransactionSections = Partial<Record<FileSectionId, ReactNode>>;
const WIDE = new Set<FileSectionId>(["mls-property", "stage-checklist", "commission-estimate", "vendors", "file-history", "reopen-review", "gc-checklist"]);
/** Center the collision rectangle over the next logical card, including tall/full-width sections. */
export const sectionKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const delta = event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : event.code === "ArrowDown" || event.code === "ArrowRight" ? 1 : 0;
  if (!delta || !context.active || !context.collisionRect) return;
  event.preventDefault();
  const items = context.active.data.current?.sortable?.items as FileSectionId[] | undefined;
  if (!items) return;
  const index = items.indexOf((context.over?.id ?? context.active.id) as FileSectionId), target = items[index + delta];
  if (index < 0 || !target) return;
  const rect = context.droppableRects.get(target);
  if (!rect) return;
  return { x: rect.left + (rect.width - context.collisionRect.width) / 2, y: rect.top + (rect.height - context.collisionRect.height) / 2 };
};
function SortableSection({ id, children, editing, first, last, onMove }: { id: FileSectionId; children: ReactNode; editing: boolean; first: boolean; last: boolean; onMove(direction: -1 | 1): void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return <section ref={setNodeRef} data-transaction-section={id} aria-label={SECTION_LABELS[id]} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("relative min-w-0", WIDE.has(id) && "xl:col-span-2", isDragging && "z-20 rounded-card shadow-card-hover")}>
    {editing && <div className="flex min-h-11 items-center justify-between gap-2 rounded-t-panel border border-b-0 border-border bg-tint px-2 py-1 text-xs">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag ${SECTION_LABELS[id]}`} className="flex min-h-11 min-w-0 touch-none items-center gap-2 rounded-md px-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"><GripVertical className="h-4 w-4 shrink-0" aria-hidden/><span className="truncate">{SECTION_LABELS[id]}</span></button>
      <div className="flex shrink-0"><Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={first} aria-label={`Move ${SECTION_LABELS[id]} earlier`} onClick={() => onMove(-1)}><ArrowUp aria-hidden/></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={last} aria-label={`Move ${SECTION_LABELS[id]} later`} onClick={() => onMove(1)}><ArrowDown aria-hidden/></Button></div>
    </div>}
    {children}
  </section>;
}
export function TransactionSectionLayout({ sections, profile = "realEstate" }: { sections: TransactionSections; profile?: TransactionLayoutProfile }) {
  const { layout, status, setOrder, reset, retry } = useTransactionLayoutStore();
  const [customizing, setCustomizing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sectionKeyboardCoordinates, scrollBehavior: "auto" }));
  const order: FileSectionId[] = layout[profile], visible = order.filter(id => sections[id] !== undefined && sections[id] !== null && sections[id] !== false);
  const available = status.phase === "ready" || status.phase === "saving", editing = customizing && available;
  const changed = order.join("|") !== defaultTransactionLayout()[profile].join("|");
  function move(active: FileSectionId, target: FileSectionId) { if (editing) setOrder(profile, moveVisibleSection(order, visible, active, target)); }
  function end(event: DragEndEvent) { if (event.over) move(event.active.id as FileSectionId, event.over.id as FileSectionId); }
  return <div className="min-w-0 space-y-4" data-layout-profile={profile}>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-card px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-semibold">Your transaction layout</p><p role={status.phase === "error" || status.phase === "conflict" || status.phase === "signed-out" ? "alert" : "status"} className="mt-1 text-xs text-muted-foreground">{status.phase === "ready" ? `${status.message} · applies across your transactions` : status.message}</p>{customizing && <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">Drag a section by its handle, or use the arrows to move it earlier or later. With a keyboard, press Space on a handle, use the arrow keys, then Space to place it.</p>}</div>
      <div className="flex flex-wrap gap-2">{status.phase === "error" && <Button type="button" size="sm" variant="ghost" onClick={() => void retry()}>Retry layout</Button>}{status.phase === "conflict" && <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>Reload layout</Button>}{customizing && changed && <Button type="button" size="sm" variant="ghost" disabled={!available} onClick={() => reset(profile)}><RotateCcw aria-hidden/>Reset layout</Button>}<Button type="button" size="sm" variant={customizing ? "default" : "outline"} disabled={!available} onClick={() => setCustomizing(value => !value)}>{customizing ? <Check aria-hidden/> : <LayoutGrid aria-hidden/>}{customizing ? "Done arranging" : "Customize layout"}</Button></div>
    </div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end} accessibility={{ screenReaderInstructions: { draggable: "Press Space to lift this transaction section. Use the arrow keys to move it, then Space to place it or Escape to cancel." } }}>
      <SortableContext items={visible} strategy={rectSortingStrategy}><div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-2">{visible.map((id, index) => <SortableSection key={id} id={id} editing={editing} first={index === 0} last={index === visible.length - 1} onMove={direction => { const target = visible[index + direction]; if (target) move(id, target); }}>{sections[id]}</SortableSection>)}</div></SortableContext>
    </DndContext>
  </div>;
}
