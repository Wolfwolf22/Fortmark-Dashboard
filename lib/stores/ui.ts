"use client";

import { create } from "zustand";

export type QuickCreateKind =
  | "listing"
  | "transaction"
  | "lead"
  | "event"
  | "document";

/** A contact a quick-create dialog was opened for: the deal is theirs. */
export interface QuickCreateContact {
  id: string;
  name: string;
}

interface UiState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  quickCreate: QuickCreateKind | null;
  /** Set when "Create transaction" is used from a contact; cleared whenever the dialog closes. */
  quickCreateContact: QuickCreateContact | null;
  setQuickCreate: (kind: QuickCreateKind | null, contact?: QuickCreateContact | null) => void;
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
  quickCreateContact: null,
  setQuickCreate: (quickCreate, contact = null) => set({ quickCreate, quickCreateContact: quickCreate ? contact : null }),
  leavingFrom: null,
  setLeavingFrom: (leavingFrom) => set({ leavingFrom }),
}));
