"use client";

import * as React from "react";
import { CalendarRange, Maximize2 } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateRangePreset } from "@/lib/data/types";
import { PRESET_LABELS, PRESETS, periodSublabel } from "@/lib/dates";
import { SampleChip } from "@/components/data/sample-data";
import type { DataDomain } from "@/lib/data/provenance";
import { cn } from "@/lib/utils";

interface WidgetExpandContextValue {
  expanded: boolean;
}

const WidgetExpandContext = React.createContext<WidgetExpandContextValue>({
  expanded: false,
});

/** Widgets read this to render a denser or fuller layout when expanded. */
export function useWidgetExpanded(): boolean {
  return React.useContext(WidgetExpandContext).expanded;
}

export interface WidgetCardProps {
  icon: LucideIcon;
  title: string;
  /** Period sublabel; pass null to hide (for period-independent widgets). */
  preset?: DateRangePreset | null;
  /** Set when the widget offers its own period override menu. */
  onPresetChange?: (preset: DateRangePreset | null) => void;
  /** Whether the preset is an override (shows the "follows page" reset item). */
  presetOverridden?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** Extra header controls rendered before the standard icon buttons. */
  headerExtra?: React.ReactNode;
  /**
   * Where this widget's numbers come from.
   *
   * Required rather than optional: every widget states its provenance, so a
   * new one cannot quietly render fabricated figures with nothing to say so.
   * A live domain renders no chip, so this stays correct when a domain
   * becomes real instead of leaving a stale label on real data.
   */
  domain: DataDomain;
  /** Disable the expand button (e.g. for the featured image card). */
  expandable?: boolean;
  dragHandle?: React.ReactNode;
}

/**
 * The bento card shell: icon + title + period sublabel on the left, small
 * monochrome icon buttons on the right. Expand renders the same children
 * inside a full-screen dialog with `useWidgetExpanded() === true`.
 */
export function WidgetCard({
  icon: Icon,
  title,
  preset,
  onPresetChange,
  presetOverridden,
  children,
  className,
  contentClassName,
  headerExtra,
  domain,
  expandable = true,
  dragHandle,
}: WidgetCardProps) {
  const [expanded, setExpanded] = React.useState(false);

  const header = (
    <div className="flex items-start justify-between gap-2 p-6 pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-tint">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold leading-tight">{title}</h3>
          <SampleChip domain={domain} />
          {preset != null && (
            <p className="text-micro mt-0.5">{periodSublabel(preset)}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {headerExtra}
        {onPresetChange && preset != null && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="muted" size="icon-sm" aria-label={`Change period for ${title}`}>
                    <CalendarRange />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Change period</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Period</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={presetOverridden ? preset : "__follow"}
                onValueChange={(v) =>
                  onPresetChange(v === "__follow" ? null : (v as DateRangePreset))
                }
              >
                <DropdownMenuRadioItem value="__follow">
                  Follow page period
                </DropdownMenuRadioItem>
                {PRESETS.map((p) => (
                  <DropdownMenuRadioItem key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {expandable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="muted"
                size="icon-sm"
                aria-label={`Expand ${title}`}
                onClick={() => setExpanded(true)}
              >
                <Maximize2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Expand</TooltipContent>
          </Tooltip>
        )}
        {dragHandle}
      </div>
    </div>
  );

  return (
    <>
      <Card className={cn("flex h-full flex-col transition-shadow duration-200 hover:shadow-card-hover", className)}>
        {header}
        <WidgetExpandContext.Provider value={{ expanded: false }}>
          <div className={cn("min-h-0 flex-1 px-6 pb-6", contentClassName)}>{children}</div>
        </WidgetExpandContext.Provider>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[85vh] w-[min(1100px,92vw)] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-tint">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              {title}
            </DialogTitle>
            {preset != null && (
              <DialogDescription className="text-micro">
                {periodSublabel(preset)}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WidgetExpandContext.Provider value={{ expanded: true }}>
              {expanded && children}
            </WidgetExpandContext.Provider>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
