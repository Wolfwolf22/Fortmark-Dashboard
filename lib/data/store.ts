import { create } from "zustand";

/**
 * Version counter bumped by every mock mutation. `useQuery` subscribes to it,
 * so writes propagate exactly like a server mutation followed by
 * revalidation would.
 */
interface DataVersionState {
  version: number;
  bump: () => void;
}

export const useDataVersion = create<DataVersionState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

export const bumpDataVersion = () => useDataVersion.getState().bump();
