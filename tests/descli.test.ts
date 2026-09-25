import { test } from "node:test";
import assert from "node:assert/strict";
import { lintDescriptions, descriptionScore } from "../src/descli.js";
import type { ToolDef } from "../src/registry.js";

const def = (name: string, description: string, props: Record<string, unknown> = {}): ToolDef => ({
  name,
  description,
  inputSchema: { type: "object", properties: props },
  handler: () => ({ content: [] }),
});

test("clean descriptions pass", () => {
  const clean = [
    def("gh_create_issue", "Create an issue in a GitHub repository. Returns the created issue number and URL.", { owner: {}, repo: {}, title: {} }),
    def("fs_read", "Read a text file inside the sandboxed workspace and return its contents."),
  ];
  assert.deepEqual(lintDescriptions(clean), []);
  assert.equal(descriptionScore(clean, lintDescriptions(clean)), 1);
});

test("each smell fires individually", () => {
  const flagged = lintDescriptions([
    def("tiny", "Echo it"),
    def("shouty", `Does stuff with things. ${"padding ".repeat(100)}`),
    def("label_like", "Get user profile"),
    def("vague_thing", "Handles various stuff for the user account."),
    def("silent_query", "Search the catalog"),
    def("param_heavy", "Update the widget record.", { a: {}, b: {}, c: {}, d: {} }),
    def("dupe_a", "List all branches of a repository, returning names."),
    def("dupe_b", "List all branches of a repository, returning names."),
  ]);
  const byTool = new Map(flagged.map((f) => [f.tool, f.issues]));
  assert.ok(byTool.get("tiny")?.includes("too-short"));
  assert.ok(byTool.get("shouty")?.some((i) => i === "too-long" || i === "vague-words"));
  assert.ok(byTool.get("label_like")?.includes("no-terminal-punctuation"));
  assert.ok(byTool.get("vague_thing")?.includes("vague-words"));
  assert.ok(byTool.get("silent_query")?.includes("query-tool-without-result-description"));
  assert.ok(byTool.get("param_heavy")?.includes("many-params-without-guidance"));
  assert.ok(byTool.get("dupe_b")?.includes("duplicate-of:dupe_a"));
  assert.ok(byTool.get("dupe_a")?.includes("has-duplicate-twin"));
});

test("query tool with result hint is clean; non-query short-form is fine", () => {
  assert.deepEqual(
    lintDescriptions([
      def("search_news", "Search news articles; returns titles, sources and dates."),
      def("uuid_generate", "Generate a RFC 4122 version 4 UUID."),
    ]),
    [],
  );
});

test("score reflects the flagged ratio", () => {
  const mixed = [def("a", "Does stuff here."), def("b", "Sends a message to a Slack channel and returns the message ts.")];
  assert.equal(descriptionScore(mixed, lintDescriptions(mixed)), 0.5);
});
