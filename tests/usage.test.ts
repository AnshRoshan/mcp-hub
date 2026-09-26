import { test } from "node:test";
import assert from "node:assert/strict";
import { PlatformDb } from "../src/platform/db.js";

test("usage rollup: buckets, totals, latency, and top tools", () => {
  const db = new PlatformDb(":memory:");
  db.recordUsage("u1", "time_now", true, 12, 100);
  db.recordUsage("u1", "time_now", true, 8, 100);
  db.recordUsage("u1", "fetch_url", false, 40, 0);
  db.recordUsage("u2", "time_now", true, 5, 50);

  const s = db.usageSummary("u1", 14);
  assert.equal(s.totalCalls, 3);
  assert.equal(s.totalErrors, 1);
  assert.equal(s.todayCalls, 3);
  assert.equal(s.avgLatencyMs, 20);
  assert.equal(s.series.length, 14);
  assert.equal(s.series[s.series.length - 1].calls, 3);
  assert.equal(s.series[s.series.length - 1].errors, 1);
  assert.equal(s.topTools[0].tool, "time_now");
  assert.equal(s.topTools[0].calls, 2);

  // Per-user isolation: nobody else's calls leak into a summary.
  assert.equal(db.usageSummary("u2", 14).totalCalls, 1);
  assert.equal(db.usageSummary("nobody", 14).totalCalls, 0);
  db.db.close();
});

test("usage rollup: empty history still returns a full zeroed series", () => {
  const db = new PlatformDb(":memory:");
  const s = db.usageSummary("u1", 7);
  assert.equal(s.series.length, 7);
  assert.ok(s.series.every((d) => d.calls === 0 && d.errors === 0));
  assert.equal(s.totalCalls, 0);
  assert.equal(s.totalErrors, 0);
  assert.equal(s.avgLatencyMs, 0);
  assert.deepEqual(s.topTools, []);
  db.db.close();
});
