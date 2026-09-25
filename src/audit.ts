/**
 * Structured audit logger for MCP tool calls.
 *
 * Every tool invocation is logged with:
 *   - correlation ID (UUID, propagated via MCP headers)
 *   - user ID (or "anonymous")
 *   - tool name
 *   - input size (bytes)
 *   - output size (bytes)
 *   - latency (ms)
 *   - success / error
 *
 * Configure via env vars:
 *   AUDIT_LOG_ENABLED=true           (default: true)
 *   AUDIT_LOG_FORMAT=json|text       (default: json)
 *   AUDIT_LOG_MASK_ARGS=true         mask sensitive arg values (default: false)
 */

import { randomUUID } from "node:crypto";
import { env, envBool } from "./utils.js";

const enabled = envBool("AUDIT_LOG_ENABLED", true);
const format: "json" | "text" = (env("AUDIT_LOG_FORMAT") ?? "json") as "json" | "text";
const maskArgs = envBool("AUDIT_LOG_MASK_ARGS", false);

/** Generate a correlation ID for a new request. */
export function newCorrelationId(): string {
  return randomUUID();
}

/** Keys whose values should be masked in logs. */
const SENSITIVE_KEYS = new Set([
  "password", "secret", "token", "api_key", "apikey", "authorization",
  "cookie", "credentials", "env", "headers",
]);

/** Deep-clone and mask sensitive values in an args object. */
function maskSensitive(args: Record<string, unknown>): Record<string, unknown> {
  if (!maskArgs) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = typeof v === "string" ? "***" : "[masked]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = maskSensitive(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface AuditEntry {
  ts: string;
  correlationId: string;
  userId: string;
  tool: string;
  inputBytes: number;
  outputBytes: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
  args?: Record<string, unknown>;
}

/** Start timing a tool call. Returns a finish function. */
export function startAudit(
  correlationId: string,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
): (result: { ok: boolean; outputBytes: number; error?: string }) => void {
  if (!enabled) return () => {};
  const start = performance.now();
  const inputBytes = JSON.stringify(args).length;

  return (result) => {
    const latencyMs = Math.round(performance.now() - start);
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      correlationId,
      userId: userId || "anonymous",
      tool: toolName,
      inputBytes,
      outputBytes: result.outputBytes,
      latencyMs,
      ok: result.ok,
    };
    if (result.error) entry.error = result.error;
    if (maskArgs) entry.args = maskSensitive(args);

    if (format === "json") {
      console.error(JSON.stringify(entry));
    } else {
      const status = entry.ok ? "OK" : "ERR";
      const errPart = entry.error ? ` err=${entry.error}` : "";
      console.error(
        `[audit] ${entry.ts} ${status} corr=${entry.correlationId.slice(0, 8)} ` +
        `user=${entry.userId} tool=${entry.tool} ` +
        `in=${entry.inputBytes}B out=${entry.outputBytes}B ` +
        `lat=${entry.latencyMs}ms${errPart}`,
      );
    }
  };
}

export function auditEnabled(): boolean {
  return enabled;
}
