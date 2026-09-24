"use client";

import { create } from "zustand";

export type QuickCreateKind =
  | "listing"
  | "transaction"
  | "lead"
  | "event"
  | "document";

interface UiState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  quickCreate: QuickCreateKind | null;
  setQuickCreate: (kind: QuickCreateKind | null) => void;
  /**
   * The pathname whose content is playing its exit animation, or null.
   *
   * Keyed to a pathname rather than a boolean so the page that arrives never
   * inherits the exit state: the moment the route changes, the new content no
   * longer matches and renders its entrance instead.
   */
  leavingFrom: string | null;
  setLeavingFrom: (pathname: string | null) => void;
}

/**
 * Transient shell state. Nothing here is persisted: the pinned nav rail it
 * used to remember no longer exists (the shell navigates from the top bar).
 */
export const useUiStore = create<UiState>()((set) => ({
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  quickCreate: null,
  setQuickCreate: (quickCreate) => set({ quickCreate }),
  leavingFrom: null,
  setLeavingFrom: (leavingFrom) => set({ leavingFrom }),
}));
