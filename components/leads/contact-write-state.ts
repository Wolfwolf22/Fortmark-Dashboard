/** Typed application failures can still follow a durable commit. */
export function contactWriteUncertain(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== "number" || status >= 500;
}

/** Lost authorization hides retained data until the contact view is reopened. */
export function contactAccessLost(error: unknown): boolean {
  return [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0);
}
