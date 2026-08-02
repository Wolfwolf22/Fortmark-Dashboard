"use client";

/**
 * The Home bento grid: renders widgets in the persisted order from the layout
 * store and lets the user drag-reorder them (pointer or keyboard) via a grip
 * handle at the top center of each card. The card body itself is not
 * draggable, so inner controls stay clickable.
 *
 * `fixedLead` is rendered as the grid's first child but is deliberately NOT a
 * `SortableContext` item and carries no grip, expand or remove control. That is
 * what makes the Home identity card permanent: there is no id for dnd-kit to
 * move, and no persisted order that can place anything ahead of it.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_WIDGET_ORDER, WidgetId, useLayoutStore } from "@/lib/stores/layout";
import { cn } from "@/lib/utils";
import { WIDGETS } from "./widget-registry";

const GRID_CLASS = "grid grid-cols-1 gap-5 md:grid-cols-6 xl:grid-cols-12";

function SortableWidget({ id }: { id: WidgetId }) {
  const def = WIDGETS[id];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const translate = CSS.Translate.toString(transform);
  const Widget = def.component;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: translate
          ? `${translate}${isDragging ? " scale(1.02)" : ""}`
          : undefined,
        transition,
      }}
      className={cn(
        "group relative",
        def.spanClass,
        isDragging && "z-20 rounded-card shadow-card-hover"
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${id} widget`}
        className={cn(
          "absolute left-1/2 top-1.5 z-10 -translate-x-1/2 cursor-grab touch-none rounded-md border border-border bg-card px-1.5 py-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing",
          isDragging && "opacity-100"
        )}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Widget />
    </div>
  );
}

/** Pre-mount stand-in matching the default layout, so first paint is stable. */
function GridSkeleton({
  fixedLead,
  fixedLeadSpanClass,
}: {
  fixedLead?: React.ReactNode;
  fixedLeadSpanClass?: string;
}) {
  return (
    <div className={GRID_CLASS}>
      {fixedLead && <div className={fixedLeadSpanClass}>{fixedLead}</div>}
      {DEFAULT_WIDGET_ORDER.map((id) => (
        <Card
          key={id}
          className={cn("flex min-h-[220px] flex-col p-6", WIDGETS[id].spanClass)}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="mt-6 h-10 w-2/5" />
          <Skeleton className="mt-auto h-14 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function BentoGrid({
  fixedLead,
  fixedLeadSpanClass = "md:col-span-3 xl:col-span-4 md:row-span-2",
}: {
  /** Permanent, non-sortable first cell. Omitted when the feature is off. */
  fixedLead?: React.ReactNode;
  fixedLeadSpanClass?: string;
} = {}) {
  const widgetOrder = useLayoutStore((s) => s.widgetOrder);
  const setWidgetOrder = useLayoutStore((s) => s.setWidgetOrder);
  const resetLayout = useLayoutStore((s) => s.resetLayout);

  // The order is persisted; gate on mount to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = widgetOrder.indexOf(active.id as WidgetId);
    const newIndex = widgetOrder.indexOf(over.id as WidgetId);
    if (oldIndex < 0 || newIndex < 0) return;
    setWidgetOrder(arrayMove(widgetOrder, oldIndex, newIndex));
  }

  if (!mounted)
    return (
      <GridSkeleton fixedLead={fixedLead} fixedLeadSpanClass={fixedLeadSpanClass} />
    );

  const orderChanged = widgetOrder.join("|") !== DEFAULT_WIDGET_ORDER.join("|");

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
          <div className={GRID_CLASS}>
            {fixedLead && <div className={fixedLeadSpanClass}>{fixedLead}</div>}
            {widgetOrder.map((id) => (
              <SortableWidget key={id} id={id} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {orderChanged && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={resetLayout}
          >
            Reset layout
          </Button>
        </div>
      )}
    </>
  );
}
