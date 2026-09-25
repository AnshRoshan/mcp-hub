import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AUDIT_LOG_ENABLED = "true";
process.env.AUDIT_LOG_FORMAT = "json";
process.env.AUDIT_LOG_MASK_ARGS = "true";

const { newCorrelationId, startAudit, auditEnabled } = await import("../src/audit.js");

function captureConsoleError(fn: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

interface LoggedEntry {
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

test("audit is enabled per env", () => {
  assert.equal(auditEnabled(), true);
});

test("correlation ids are UUIDs", () => {
  const id = newCorrelationId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.notEqual(id, newCorrelationId());
});

test("a completed call logs one JSON entry with metrics", () => {
  const lines = captureConsoleError(() => {
    const finish = startAudit("corr-1", "alice", "demo_tool", { keep: "me" });
    finish({ ok: true, outputBytes: 123 });
  });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]) as LoggedEntry;
  assert.equal(entry.correlationId, "corr-1");
  assert.equal(entry.userId, "alice");
  assert.equal(entry.tool, "demo_tool");
  assert.equal(entry.ok, true);
  assert.equal(entry.outputBytes, 123);
  assert.ok(entry.inputBytes > 0);
  assert.ok(Number.isFinite(entry.latencyMs) && entry.latencyMs >= 0);
  assert.match(entry.ts, /T.*Z$/);
});

test("sensitive args are masked recursively", () => {
  const lines = captureConsoleError(() => {
    const finish = startAudit("corr-2", "bob", "echo", {
      token: "secret-value",
      nested: { ApiKey: "abc", safe: "visible" },
      password: "p",
    });
    finish({ ok: true, outputBytes: 1 });
  });
  const entry = JSON.parse(lines[0]) as LoggedEntry;
  const nested = entry.args?.nested as Record<string, unknown>;
  assert.equal(entry.args?.token, "***");
  assert.equal(nested.safe, "visible");
  assert.equal(nested.ApiKey, "***");
  assert.equal(entry.args?.password, "***");
  assert.ok(!JSON.stringify(entry).includes("secret-value"));
  assert.ok(!JSON.stringify(entry).includes("\"abc\""));
});

test("failed calls record the error", () => {
  const lines = captureConsoleError(() => {
    startAudit("corr-3", "", "boom", {})({ ok: false, outputBytes: 0, error: "exploded" });
  });
  const entry = JSON.parse(lines[0]) as LoggedEntry;
  assert.equal(entry.ok, false);
  assert.equal(entry.error, "exploded");
  assert.equal(entry.userId, "anonymous");
});

test("text format emits a single readable line", async () => {
  process.env.AUDIT_LOG_FORMAT = "text";
  const { startAudit: startText } = await import("../src/audit.js?text");
  const lines = captureConsoleError(() => {
    startText("corr-4", "carol", "pretty_tool", {})({ ok: true, outputBytes: 9 });
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[audit\] .* OK corr=corr-4 user=carol tool=pretty_tool in=\d+B out=9B lat=\d+ms/);
});
