"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type QuickCreateKind =
  | "listing"
  | "transaction"
  | "lead"
  | "event"
  | "document";

interface UiState {
  railPinned: boolean;
  setRailPinned: (pinned: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  quickCreate: QuickCreateKind | null;
  setQuickCreate: (kind: QuickCreateKind | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      railPinned: false,
      setRailPinned: (railPinned) => set({ railPinned }),
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      quickCreate: null,
      setQuickCreate: (quickCreate) => set({ quickCreate }),
    }),
    {
      name: "fm.ui.v1",
      partialize: (state) => ({ railPinned: state.railPinned }),
    }
  )
);
