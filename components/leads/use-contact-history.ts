"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDataVersion } from "@/lib/data/store";
import type { HistoryPage } from "@/lib/contacts/history";

/** A fresh first page on mutation; older pages append only to their own contact. */
export function useContactHistory<T extends { id: string }>(id: string, load: (id: string, cursor?: string) => Promise<HistoryPage<T>>, refreshKey = 0) {
  const version = useDataVersion(s => s.version);
  const [tick, setTick] = useState(0);
  const key = `${id}:${version}:${tick}:${refreshKey}`;
  const current = useRef(key);
  current.current = key;
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<{
    id: string; key: string; data?: HistoryPage<T>; loading: boolean;
    error: Error | null; loadingOlder: boolean; olderError: Error | null; olderLoaded: boolean;
  }>({ id, key, loading: true, error: null, loadingOlder: false, olderError: null, olderLoaded: false });
  const olderBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    olderBusy.current = false;
    setState(previous => ({ id, key, data: previous.id === id ? previous.data : undefined, loading: true, error: null, loadingOlder: false, olderError: null, olderLoaded: false }));
    loadRef.current(id).then(data => {
      if (!cancelled && current.current === key) setState({ id, key, data, loading: false, error: null, loadingOlder: false, olderError: null, olderLoaded: false });
    }).catch(error => {
      if (!cancelled && current.current === key) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error : new Error("History could not be loaded.") }));
    });
    return () => { cancelled = true; };
  }, [id, key]);

  const refetch = useCallback(() => setTick(value => value + 1), []);
  async function loadOlder() {
    const cursor = state.data?.nextCursor;
    if (!cursor || state.loading || state.key !== key || olderBusy.current) return;
    olderBusy.current = true;
    setState(previous => ({ ...previous, loadingOlder: true, olderError: null }));
    try {
      const page = await loadRef.current(id, cursor);
      if (current.current !== key) return;
      setState(previous => {
        const seen = new Set(previous.data?.items.map(item => item.id));
        return { ...previous, data: { ...page, items: [...(previous.data?.items ?? []), ...page.items.filter(item => !seen.has(item.id))] }, loadingOlder: false, olderError: null, olderLoaded: true };
      });
    } catch (error) {
      if (current.current === key) setState(previous => ({ ...previous, loadingOlder: false, olderError: error instanceof Error ? error : new Error("Older history could not be loaded.") }));
    } finally {
      if (current.current === key) olderBusy.current = false;
    }
  }
  return { ...state, data: state.id === id ? state.data : undefined, loading: state.id !== id || state.loading, refetch, loadOlder };
}
