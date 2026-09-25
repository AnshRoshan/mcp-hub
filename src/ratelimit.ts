/**
 * Per-user sliding-window rate limiter for MCP tool calls.
 *
 * Configure via env vars:
 *   RATE_LIMIT_ENABLED=true          (default: false in single-user, true in platform)
 *   RATE_LIMIT_DEFAULT=60            per-user default: max calls per window
 *   RATE_LIMIT_WINDOW_MS=60000       window size in ms (default 1 minute)
 *
 * Per-tool overrides can be added later via the prefs system.
 */

import { env, envBool } from "./utils.js";

interface WindowEntry {
  /** Timestamps of calls within the current window. */
  timestamps: number[];
}

const enabled = envBool("RATE_LIMIT_ENABLED", false);
const defaultMax = Math.max(Number(env("RATE_LIMIT_DEFAULT") ?? "60"), 1);
const windowMs = Math.max(Number(env("RATE_LIMIT_WINDOW_MS") ?? "60000"), 1000);

/** State keyed by `${userId}:${toolName}`. */
const windows = new Map<string, WindowEntry>();

/** Evict stale entries every 5 minutes. */
setInterval(() => {
  const cutoff = Date.now() - windowMs;
  for (const [key, entry] of windows) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) windows.delete(key);
  }
}, 5 * 60_000).unref();

function key(userId: string, toolName: string): string {
  return `${userId}:${toolName}`;
}

/**
 * Check whether a call is allowed. Returns `{ allowed, retryAfterMs }`.
 * If allowed, the caller MUST call `record()` after the call completes.
 */
export function checkRateLimit(
  userId: string,
  toolName: string,
  overrideMax?: number,
): { allowed: boolean; retryAfterMs: number; limit: number; remaining: number } {
  if (!enabled) return { allowed: true, retryAfterMs: 0, limit: Infinity, remaining: Infinity };

  const k = key(userId, toolName);
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = windows.get(k) ?? { timestamps: [] };

  // Prune old entries.
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  windows.set(k, entry);

  const max = overrideMax ?? defaultMax;
  const remaining = max - entry.timestamps.length;

  if (remaining <= 0) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = oldest + windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1), limit: max, remaining: 0 };
  }

  return { allowed: true, retryAfterMs: 0, limit: max, remaining: remaining - 1 };
}

/** Record a completed call (only if rate limiting is enabled). */
export function recordRateLimit(userId: string, toolName: string): void {
  if (!enabled) return;
  const k = key(userId, toolName);
  const entry = windows.get(k) ?? { timestamps: [] };
  entry.timestamps.push(Date.now());
  windows.set(k, entry);
}

export function rateLimitInfo(): { enabled: boolean; defaultMax: number; windowMs: number } {
  return { enabled, defaultMax, windowMs };
}
