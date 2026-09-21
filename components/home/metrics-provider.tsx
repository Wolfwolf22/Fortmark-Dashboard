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
import { createContext, useContext, type ReactNode } from "react";
import { getBrokerageMetrics } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import type { BrokerageMetrics } from "@/lib/metrics/types";

interface MetricsContextValue {
  metrics: BrokerageMetrics | undefined;
  loading: boolean;
  /** The request itself failed — not a domain reporting itself unavailable. */
  error: Error | null;
}

const MetricsContext = createContext<MetricsContextValue | null>(null);

export function HomeMetricsProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useQuery(() => getBrokerageMetrics(), []);
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
