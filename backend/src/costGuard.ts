import { logger } from "./logger.js";

// In-memory daily caps to stop a bug or abuse from running up paid external calls
// (Gemini image generation, xAI realtime voice). Resets each UTC day and on
// restart — this is a runaway backstop, not billing accounting. Fast, no DB
// dependency on the hot path (DB is best-effort and could be down).
const counters = new Map<string, number>();
let day = "";

function today(): string {
  // Avoid Date.now-based drift concerns; date string is enough for a daily bucket.
  return new Date().toISOString().slice(0, 10);
}

function rollover(): void {
  const d = today();
  if (d !== day) {
    day = d;
    counters.clear();
  }
}

/**
 * Reserve one unit against a daily bucket. Returns true if allowed (and counts
 * it), false if the bucket is already at/over `max`.
 */
export function allow(bucket: string, max: number): boolean {
  rollover();
  const used = counters.get(bucket) ?? 0;
  if (used >= max) {
    logger.warn({ bucket, used, max }, "daily cost cap reached");
    return false;
  }
  counters.set(bucket, used + 1);
  return true;
}

/** Current usage snapshot (for the admin/analytics view). */
export function usage(): { day: string; counts: Record<string, number> } {
  rollover();
  return { day, counts: Object.fromEntries(counters) };
}
