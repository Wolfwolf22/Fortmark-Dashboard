/**
 * Deterministic PRNG (mulberry32) so the mock dataset is identical on every
 * load — server and client render the same markup, and screenshots are
 * reproducible. Never use Math.random in the mock layer.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof mulberry32>;

export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function float(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Round a price to a listing-plausible figure (e.g. 1,249,000). */
export function listingPrice(rng: Rng, min: number, max: number): number {
  const raw = float(rng, min, max);
  if (raw >= 1_000_000) return Math.round(raw / 25_000) * 25_000 - 1_000;
  if (raw >= 500_000) return Math.round(raw / 10_000) * 10_000 - 1_000;
  return Math.round(raw / 5_000) * 5_000;
}
