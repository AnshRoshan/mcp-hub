import { test } from "node:test";
import assert from "node:assert/strict";
import { devkitDefs } from "../src/builtins/devkit.js";
import { youtubeDefs, videoId } from "../src/builtins/youtube.js";
import { lintDescriptions } from "../src/descli.js";

const tool = (name: string) => {
  const def = [...devkitDefs, ...youtubeDefs].find((d) => d.name === name);
  if (!def) throw new Error(`missing tool ${name}`);
  return def;
};

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await tool(name).handler(args);
  const text = (result.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("");
  return { text, json: JSON.parse(text) as Record<string, unknown> };
};

test("regex_test reports matches, groups, and named groups", async () => {
  const { json } = await call("regex_test", {
    pattern: "(?<year>\\d{4})-(\\d{2})-(\\d{2})",
    sample: "born 1999-12-31, epoch 2001-01-01 ok",
  });
  assert.equal(json.valid, true);
  assert.equal(json.matchCount, 2);
  const matches = json.matches as { text: string; groups: string[]; named: Record<string, string> }[];
  assert.equal(matches[0].text, "1999-12-31");
  assert.equal(matches[0].named.year, "1999");
  assert.equal(matches[1].groups[1], "01");
});

test("regex_test returns structured error for invalid pattern", async () => {
  const { json } = await call("regex_test", { pattern: "(unclosed", sample: "x" });
  assert.equal(json.valid, false);
  assert.ok(typeof json.error === "string");
});

test("text_diff produces patch and line stats", async () => {
  const { json } = await call("text_diff", { before: "a\nb\nc", after: "a\nB\nc\n d" });
  assert.equal(json.added, 2);
  assert.equal(json.removed, 1);
  assert.equal(json.unchanged, 2);
  assert.ok((json.patch as string).includes("-b"));
  assert.ok((json.patch as string).includes("+B"));
});

test("text_diff refuses oversized inputs with guidance", async () => {
  const big = "x\n".repeat(2001);
  await assert.rejects(
    async () => tool("text_diff").handler({ before: big, after: "x" }),
    /limited to 2000 lines/,
  );
});

test("cron_parse explains and computes next UTC runs", async () => {
  const { json } = await call("cron_parse", {
    expression: "30 9 * * 1",
    from: "2026-09-24T00:00:00Z",
    count: 2,
  });
  assert.deepEqual(json.nextRuns, ["2026-09-28T09:30:00.000Z", "2026-10-05T09:30:00.000Z"]);
  assert.ok((json.explain as string).includes("minute = 30"));
});

test("cron_parse rejects malformed expressions", async () => {
  await assert.rejects(async () => tool("cron_parse").handler({ expression: "* * *" }), /Expected 5 cron fields/);
  await assert.rejects(async () => tool("cron_parse").handler({ expression: "99 * * * *" }), /out of range/);
});

test("json_query validates and extracts by path", async () => {
  const doc = JSON.stringify({ data: { items: [{ name: "a" }, { name: "b" }, { name: "c" }] } });
  const ok = await call("json_query", { json: doc, path: "data.items[2].name" });
  assert.equal(ok.json.value, "c");
  assert.equal(ok.json.shape, "object(1 keys)");
  const bad = await call("json_query", { json: "{oops" });
  assert.equal(bad.json.valid, false);
});

test("json_query throws with key suggestions on missing path", async () => {
  await assert.rejects(
    async () => tool("json_query").handler({ json: '{"a":1,"b":2}', path: "c" }),
    /Key "c" not found \(available: a, b\)/,
  );
});

test("color_contrast computes WCAG ratios and verdicts", async () => {
  const black = await call("color_contrast", { foreground: "#000", background: "#fff" });
  assert.equal(black.json.ratio, 21);
  assert.equal(black.json.aaaNormal, true);
  const weak = await call("color_contrast", { foreground: "#888888", background: "#ffffff" });
  assert.equal(weak.json.aaNormal, false);
  assert.equal(weak.json.aaLarge, true);
});

test("videoId normalizes every common YouTube URL shape", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(videoId(id), id);
  assert.equal(videoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"), id);
  assert.equal(videoId("https://youtu.be/dQw4w9WgXcQ"), id);
  assert.equal(videoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"), id);
  assert.equal(videoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), id);
  assert.equal(videoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(videoId("not a url"), null);
});

test("new tools pass the description linter", () => {
  const smells = lintDescriptions([...devkitDefs, ...youtubeDefs]);
  assert.deepEqual(smells, []);
});
