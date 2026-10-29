"use client";

/**
 * One metrics request for the whole Home screen.
 *
 * Eleven widgets asking eleven questions produced eleven chances to disagree
 * with each other — a pipeline total taken at one instant beside a deal count
 * taken at another. The dashboard now asks once, and every tile reads the same
 * answer, so the brief is internally consistent by construction rather than by
 * luck.
 *
 * The context carries the whole payload, including each group's availability.
 * Widgets never unwrap that themselves: they hand a group to `MetricState`,
 * which renders the one honest sentence for whichever state it is in.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { getBrokerageMetrics } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import type { BrokerageMetrics } from "@/lib/metrics/types";
import { nextContactRefreshDelay } from "@/lib/contacts/workspace";

interface MetricsContextValue {
  metrics: BrokerageMetrics | undefined;
  loading: boolean;
  /** The request itself failed — not a domain reporting itself unavailable. */
  error: Error | null;
}

const MetricsContext = createContext<MetricsContextValue | null>(null);

export function HomeMetricsProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, refetch } = useQuery(() => getBrokerageMetrics(), []);
  const timed = data?.attention.availability === "available" && data.attention.data.items.some(item => Boolean(item.dueAt));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now(); refetch();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { refresh(); schedule(); }, nextContactRefreshDelay(new Date(), timed));
    };
    const resume = () => { refresh(); schedule(); };
    schedule();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refetch, timed]);
  return (
    <MetricsContext.Provider value={{ metrics: data, loading, error }}>
      {children}
    </MetricsContext.Provider>
  );
}

/**
 * Home metrics, or the reason there are none.
 *
 * Outside the provider the hook reports a permanent loading state rather than
 * throwing: a widget rendered somewhere unexpected should degrade, not take
 * the page down with it.
 */
export function useHomeMetrics(): MetricsContextValue {
  return useContext(MetricsContext) ?? { metrics: undefined, loading: true, error: null };
}
