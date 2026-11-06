"use client";
import { create } from "zustand";
import { defaultTransactionLayout, normalizeTransactionLayout, transactionLayoutSchema, type FileSectionId, type TransactionLayoutData, type TransactionLayoutProfile } from "../transactions/layout-domain";
import type { SaveState } from "../workspaces/personal-storage";

export interface TransactionLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  getSnapshot(): SaveState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  flush(): Promise<void>;
  readonly dirty: boolean;
}
type State = {
  layout: TransactionLayoutData;
  status: SaveState;
  setOrder(profile: TransactionLayoutProfile, order: FileSectionId[]): void;
  reset(profile: TransactionLayoutProfile): void;
  retry(): Promise<void>;
};
const unavailable: SaveState = { phase: "loading", message: "Loading your transaction layout…" };
let storage: TransactionLayoutStorage | null = null;
let unsubscribe: (() => void) | null = null;
export function connectTransactionLayoutStorage(next: TransactionLayoutStorage | null) {
  unsubscribe?.(); unsubscribe = null; storage = next;
  useTransactionLayoutStore.setState({ layout: defaultTransactionLayout(), status: unavailable });
  if (!next) return;
  const update = () => {
    if (storage !== next) return;
    const status = next.getSnapshot();
    let layout = useTransactionLayoutStore.getState().layout;
    if (status.phase === "signed-out") layout = defaultTransactionLayout();
    else if (status.phase === "ready") {
      try { layout = normalizeTransactionLayout(JSON.parse(next.getItem("layout") ?? "null")); }
      catch { layout = defaultTransactionLayout(); }
    }
    useTransactionLayoutStore.setState({ layout, status });
  };
  unsubscribe = next.subscribe(update); update();
}
export const useTransactionLayoutStore = create<State>((set, get) => {
  function save(layout: TransactionLayoutData) {
    if (!storage || !["ready", "saving"].includes(get().status.phase) || !transactionLayoutSchema.safeParse(layout).success) return;
    try { storage.setItem("layout", JSON.stringify(layout)); set({ layout, status: storage.getSnapshot() }); }
    catch { set({ status: { phase: "error", message: "Your layout could not be saved. Keep this page open and retry." } }); }
  }
  return {
    layout: defaultTransactionLayout(), status: unavailable,
    setOrder: (profile, order) => save({ ...get().layout, [profile]: order }),
    reset: profile => save({ ...get().layout, [profile]: defaultTransactionLayout()[profile] }),
    retry: async () => {
      const current = storage;
      if (!current || ["loading", "saving", "conflict", "signed-out"].includes(get().status.phase)) return;
      set({ status: { phase: current.dirty ? "saving" : "loading", message: current.dirty ? "Retrying layout save…" : "Loading your transaction layout…" } });
      if (current.dirty) await current.flush(); else await current.load();
    },
  };
});
