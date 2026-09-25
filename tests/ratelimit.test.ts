import { test } from "node:test";
import assert from "node:assert/strict";

// The limiter snapshots env vars at module load, so configure before importing.
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_DEFAULT = "2";
process.env.RATE_LIMIT_WINDOW_MS = "60000";

const { checkRateLimit, recordRateLimit, rateLimitInfo } = await import("../src/ratelimit.js");

// Cache-busted second instance to exercise the disabled path.
process.env.RATE_LIMIT_ENABLED = "false";
const off = await import("../src/ratelimit.js?disabled");
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_WINDOW_MS = "1100";
const fast = await import("../src/ratelimit.js?fast-window");

test("rateLimitInfo reports the active configuration", () => {
  assert.deepEqual(rateLimitInfo(), { enabled: true, defaultMax: 2, windowMs: 60_000 });
});

test("disabled limiter always allows with infinite budget", async () => {
  const m = off.checkRateLimit("u1", "t1");
  assert.equal(m.allowed, true);
  assert.equal(m.limit, Infinity);
  assert.equal(m.remaining, Infinity);
});

test("window is per user + tool", () => {
  recordRateLimit("alice", "tool_a");
  recordRateLimit("alice", "tool_a");
  let r = checkRateLimit("alice", "tool_a");
  assert.equal(r.allowed, false, "third call over the 2/window limit must be blocked");
  r = checkRateLimit("bob", "tool_a");
  assert.equal(r.allowed, true, "other users have their own window");
  r = checkRateLimit("alice", "tool_b");
  assert.equal(r.allowed, true, "other tools have their own window");
});

test("check reports remaining (after reserving this call), retryAfter counts down", () => {
  // remaining is post-reservation: an allowed call reports what's left after it.
  const fresh = checkRateLimit("carol", "x");
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 1);
  recordRateLimit("carol", "x");
  assert.equal(checkRateLimit("carol", "x").remaining, 0);
  recordRateLimit("carol", "x");
  const blocked = checkRateLimit("carol", "x");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
});

test("overrideMax raises or lowers the per-call ceiling", () => {
  recordRateLimit("dave", "y");
  recordRateLimit("dave", "y");
  assert.equal(checkRateLimit("dave", "y").allowed, false);
  assert.equal(checkRateLimit("dave", "y", 5).allowed, true, "override of 5 allows more");
  assert.equal(checkRateLimit("erin", "y", 1).allowed, true);
  recordRateLimit("erin", "y");
  assert.equal(checkRateLimit("erin", "y", 1).allowed, false);
});

test("recorded calls expire once the window passes", async () => {
  fast.recordRateLimit("zoe", "fresh");
  fast.recordRateLimit("zoe", "fresh");
  assert.equal(fast.checkRateLimit("zoe", "fresh").allowed, false, "both slots used up");
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(fast.checkRateLimit("zoe", "fresh").allowed, true, "window elapsed → budget restored");
});
