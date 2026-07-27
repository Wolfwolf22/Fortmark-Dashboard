/**
 * Simulated network latency so loading states are real. The real adapters
 * replace this with actual fetch time.
 */
export function delay(ms = 180): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
