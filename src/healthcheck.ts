/**
 * Upstream health checker: periodically probes connected MCP servers and
 * auto-reconnects failed ones with exponential backoff.
 *
 * Configure via env vars:
 *   HEALTHCHECK_ENABLED=true              (default: true)
 *   HEALTHCHECK_INTERVAL_MS=60000         probe interval (default 1 min)
 *   HEALTHCHECK_TIMEOUT_MS=10000          per-probe timeout (default 10s)
 *   HEALTHCHECK_MAX_BACKOFF_MS=300000     max backoff (default 5 min)
 */

import type { UpstreamServerConfig } from "./config.js";
import { env, envBool } from "./utils.js";

const enabled = envBool("HEALTHCHECK_ENABLED", true);
const intervalMs = Math.max(Number(env("HEALTHCHECK_INTERVAL_MS") ?? "60000"), 10_000);
const probeTimeoutMs = Math.max(Number(env("HEALTHCHECK_TIMEOUT_MS") ?? "10000"), 1_000);
const maxBackoffMs = Math.max(Number(env("HEALTHCHECK_MAX_BACKOFF_MS") ?? "300000"), 30_000);

interface ServerHealth {
  key: string;
  /** Consecutive failures. */
  failures: number;
  /** Timestamp of last probe. */
  lastProbe: number;
  /** Timestamp of last successful probe. */
  lastOk: number;
  /** Current backoff in ms (exponential). */
  backoffMs: number;
  /** Timer handle for the next probe. */
  timer: ReturnType<typeof setTimeout> | null;
}

export interface HealthCheckerCallbacks {
  /** Called when a server should be reconnected. */
  reconnect: (key: string) => Promise<void>;
  /** Called to get the current state of a server. */
  getServerState: (key: string) => { connected: boolean } | undefined;
  /** Called to get all server configs. */
  getConfigs: () => UpstreamServerConfig[];
}

const healthMap = new Map<string, ServerHealth>();
let checkerTimer: ReturnType<typeof setInterval> | null = null;
let callbacks: HealthCheckerCallbacks | null = null;

function getHealth(key: string): ServerHealth {
  let h = healthMap.get(key);
  if (!h) {
    h = { key, failures: 0, lastProbe: 0, lastOk: 0, backoffMs: 5_000, timer: null };
    healthMap.set(key, h);
  }
  return h;
}

async function probe(key: string): Promise<void> {
  if (!callbacks) return;
  const h = getHealth(key);
  const state = callbacks.getServerState(key);

  if (state?.connected) {
    // Server is healthy — reset counters.
    h.failures = 0;
    h.backoffMs = 5_000;
    h.lastOk = Date.now();
    h.lastProbe = Date.now();
    return;
  }

  // Server is disconnected — attempt reconnect with backoff.
  h.failures++;
  h.lastProbe = Date.now();
  h.backoffMs = Math.min(h.backoffMs * 2, maxBackoffMs);

  console.error(`[healthcheck] ${key}: reconnecting (attempt ${h.failures}, backoff ${h.backoffMs}ms)`);
  try {
    await callbacks.reconnect(key);
    h.failures = 0;
    h.backoffMs = 5_000;
    h.lastOk = Date.now();
    console.error(`[healthcheck] ${key}: reconnected successfully`);
  } catch (err) {
    console.error(
      `[healthcheck] ${key}: reconnect failed (${err instanceof Error ? err.message : err}), ` +
      `next retry in ${h.backoffMs}ms`,
    );
  }
}

function tick(): void {
  if (!callbacks) return;
  const configs = callbacks.getConfigs();
  const now = Date.now();

  for (const cfg of configs) {
    const h = getHealth(cfg.key);
    // Only probe if the server has failed and enough time has passed (backoff).
    if (h.failures > 0 && now - h.lastProbe < h.backoffMs) continue;
    // Or if the server was healthy but hasn't been probed recently.
    if (h.failures === 0 && now - h.lastProbe < intervalMs) continue;

    // Fire-and-forget probe (errors are logged inside `probe`).
    void probe(cfg.key);
  }
}

/** Start the health checker. Safe to call multiple times. */
export function startHealthChecker(cbs: HealthCheckerCallbacks): void {
  if (!enabled) return;
  callbacks = cbs;
  if (checkerTimer) clearInterval(checkerTimer);
  checkerTimer = setInterval(tick, Math.min(intervalMs, 30_000));
  checkerTimer.unref();
}

/** Stop the health checker. */
export function stopHealthChecker(): void {
  if (checkerTimer) {
    clearInterval(checkerTimer);
    checkerTimer = null;
  }
  for (const h of healthMap.values()) {
    if (h.timer) clearTimeout(h.timer);
  }
  healthMap.clear();
  callbacks = null;
}

export function healthCheckerInfo(): { enabled: boolean; intervalMs: number; probeTimeoutMs: number } {
  return { enabled, intervalMs, probeTimeoutMs };
}
