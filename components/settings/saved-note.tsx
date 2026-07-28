"use client";

/**
 * Quiet inline save confirmation: "Changes saved." appears next to the
 * submit button and fades out after ~2s. No toast system needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SavedNotePhase = "hidden" | "visible" | "fading";

export function useSavedNote() {
  const [phase, setPhase] = useState<SavedNotePhase>("hidden");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const show = useCallback(() => {
    clear();
    setPhase("visible");
    timers.current.push(setTimeout(() => setPhase("fading"), 2000));
    timers.current.push(setTimeout(() => setPhase("hidden"), 2600));
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { phase, show };
}

export function SavedNote({ phase }: { phase: SavedNotePhase }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "text-[13px] text-muted-foreground transition-opacity duration-500",
        phase === "visible" ? "opacity-100" : "opacity-0"
      )}
    >
      {phase === "hidden" ? "" : "Changes saved."}
    </span>
  );
}
