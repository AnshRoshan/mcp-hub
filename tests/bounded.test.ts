import { test } from "node:test";
import assert from "node:assert/strict";
import { runBounded } from "../src/bounded.js";

const source = `
  const { parentPort, workerData } = require("node:worker_threads");
  const { pattern, sample } = workerData;
  const out = [];
  for (const m of sample.matchAll(new RegExp(pattern, "g"))) {
    out.push(m[0]);
    if (out.length >= 1000) break;
  }
  parentPort.postMessage(out);
`;

test("runBounded returns the worker's result", async () => {
  const matches = await runBounded<string[]>(
    source,
    { pattern: "\\d+", sample: "a1 b22 c333" },
    { timeoutMs: 5000, label: "scan" },
  );
  assert.deepEqual(matches, ["1", "22", "333"]);
});

test("a catastrophic pattern is killed at the deadline instead of hanging", async () => {
  const started = Date.now();
  await assert.rejects(
    runBounded<string[]>(
      source,
      { pattern: "(a+)+$", sample: "a".repeat(60) + "b" },
      { timeoutMs: 400, label: "scan" },
    ),
    /scan \(timed out after 400ms\)/,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `should return near the deadline, took ${elapsed}ms`);
});

test("a worker that throws surfaces instead of resolving empty", async () => {
  await assert.rejects(
    runBounded<string[]>(source, { pattern: "(unclosed", sample: "x" }, { timeoutMs: 2000, label: "scan" }),
    /Invalid regular expression/,
  );
});
