"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Oversized headline numeral that counts up on first render. Respects
 * prefers-reduced-motion by rendering the final value immediately.
 */
export function CountUp({
  value,
  format,
  durationMs = 700,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const from = started.current ? display : 0;
    started.current = true;
    const start = performance.now();
    let frame: number;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return (
    <span className={className} aria-label={format(value)}>
      {formatRef.current(display)}
    </span>
  );
}
