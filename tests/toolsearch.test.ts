import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolIndex, MODULE_ALIASES } from "../src/toolsearch.js";
import type { ToolDef } from "../src/registry.js";

const def = (name: string, description: string): ToolDef => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
  handler: () => ({ content: [] }),
});

// A corpus shaped like the real catalog: builtins + upstream-namespace tools.
const CORPUS = [
  def("gh_create_issue", "Create an issue in a GitHub repository."),
  def("gh_search_repos", "Search GitHub repositories by query (e.g. mcp server language:typescript stars:>100)."),
  def("gh_list_branches", "List branches in a repository."),
  def("gh_merge_pull_request", "Merge an open pull request in a repository."),
  def("memory_set", "Store a persistent key-value memory the agent can recall later."),
  def("memory_search", "Search memory entries by keyword."),
  def("fs_read", "Read a text file inside the sandboxed workspace."),
  def("fs_search", "Search workspace files by name pattern or content."),
  def("knowledge_vector_search", "Semantic vector search over indexed knowledge documents."),
  def("knowledge_fts_search", "Full-text (BM25) search over the knowledge base."),
  def("jira_search_issues", "Search Jira issues using JQL query language."),
  def("jira_transition_issue", "Move a Jira issue to another status via its workflow transition."),
  def("slack_post_message", "Post a message to a Slack channel."),
  def("weather_current", "Current weather conditions for a city (Open-Meteo)."),
  def("crypto_convert", "Convert an amount between cryptocurrencies and fiat currencies."),
  def("get_current_time", "Get the current time in UTC or a given timezone."),
  def("convert_timezone", "Convert a time between IANA timezones."),
  def("notion_search_pages", "Search Notion pages and databases by title."),
  def("postgres_query", "Run a read-only SQL SELECT against the configured Postgres database."),
  def("mcpserver1_echo", "Echoes back the input text unchanged."),
];

// Same shape as production: assembleCatalog attaches each module's synonym
// text to its tools before building the index.
const PREFIX_TO_MODULE: Record<string, string> = {
  gh_: "github", memory_: "memory", fs_: "filesystem", knowledge_: "knowledge",
  jira_: "jira", slack_: "slack", weather_: "weather", crypto_: "crypto",
  notion_: "notion", postgres_: "postgres",
};
function moduleOf(name: string): string | undefined {
  if (name === "get_current_time" || name === "convert_timezone") return "time";
  for (const [p, m] of Object.entries(PREFIX_TO_MODULE)) if (name.startsWith(p)) return m;
  return undefined;
}
const aliases = new Map<string, string>();
for (const d of CORPUS) {
  const m = moduleOf(d.name);
  if (m) aliases.set(d.name, MODULE_ALIASES[m]);
}

const index = new ToolIndex(CORPUS, aliases);

test("exact-name intent ranks first", () => {
  assert.equal(index.search("create a github issue")[0].name, "gh_create_issue");
  assert.equal(index.search("list branches")[0].name, "gh_list_branches");
  assert.equal(index.search("post slack message channel")[0].name, "slack_post_message");
});

test("plural/stem folding matches", () => {
  assert.equal(index.search("branches")[0].name, "gh_list_branches");
  assert.equal(index.search("repos")[0].name, "gh_search_repos");
  // A lone ambiguous word ("issue") is a tie-class query: right tool in top 3,
  // while a verb-qualified query must rank #1.
  assert.ok(index.search("issue", 3).map((h) => h.name).includes("gh_create_issue"));
  assert.equal(index.search("create issue repository")[0].name, "gh_create_issue");
});

test("semantic-ish phrasing surfaces the right tool in top 3", () => {
  const top = (q: string) => index.search(q, 3).map((h) => h.name);
  assert.ok(top("what's the weather like in Paris right now").includes("weather_current"));
  assert.ok(top("move this jira ticket to in progress").includes("jira_transition_issue"));
  assert.ok(top("search stored memory entries by keyword").includes("memory_search"));
  assert.ok(top("run SELECT against the database").includes("postgres_query"));
  assert.ok(top("turn bitcoin into dollars").includes("crypto_convert"));
  assert.ok(top("merge PR").includes("gh_merge_pull_request"));
});

test("BM25 prefers rare-term docs: vector search beats generic 'search'", () => {
  const hits = index.search("semantic vector embedding similarity", 5);
  assert.equal(hits[0].name, "knowledge_vector_search");
});

test("deterministic ordering on score ties", () => {
  const a = index.search("search", 5);
  const b = index.search("search", 5);
  assert.deepEqual(a.map((h) => h.name), b.map((h) => h.name));
});

test("bounds: limit clamps 1..25, empty query and no-match return empty/valid", () => {
  assert.ok(index.search("weather", 1).length <= 1);
  assert.ok(index.search("weather", 999).length <= 25);
  assert.deepEqual(index.search("zzzqqq nonexistentterm"), []);
  const emptyIndex = new ToolIndex([]);
  assert.deepEqual(emptyIndex.search("anything"), []);
  assert.equal(emptyIndex.size(), 0);
});

test("module synonyms close lexical gaps (the alias layer)", () => {
  assert.equal(index.search("turn bitcoin into dollars")[0].name, "crypto_convert");
  assert.ok(index.search("remember my preferences").length > 0);
  // Without aliases the same query must miss — proving the layer carries it.
  const bare = new ToolIndex(CORPUS);
  assert.ok(!bare.search("turn bitcoin into dollars", 3).map((h) => h.name).includes("crypto_convert"));
});

test("batch accuracy ≥ 90% on the probe set", () => {
  const probes: [string, string][] = [
    ["create github issue", "gh_create_issue"],
    ["search repositories typescript", "gh_search_repos"],
    ["list branches repo", "gh_list_branches"],
    ["merge pull request", "gh_merge_pull_request"],
    ["store memory key value", "memory_set"],
    ["search my memories", "memory_search"],
    ["read file workspace", "fs_read"],
    ["find files by name", "fs_search"],
    ["semantic search knowledge", "knowledge_vector_search"],
    ["full text search documents", "knowledge_fts_search"],
    ["jql jira search", "jira_search_issues"],
    ["transition jira status", "jira_transition_issue"],
    ["slack send message", "slack_post_message"],
    ["current weather", "weather_current"],
    ["convert crypto currency amount", "crypto_convert"],
    ["what time is it", "get_current_time"],
    ["timezone conversion", "convert_timezone"],
    ["notion page lookup", "notion_search_pages"],
    ["postgres sql select query", "postgres_query"],
    ["echo text back", "mcpserver1_echo"],
  ];
  let hits = 0;
  for (const [query, expected] of probes) {
    const got = index.search(query, 3).map((h) => h.name);
    if (got[0] === expected) hits++;
    else if (got.includes(expected)) hits += 0.5; // top-3 partial credit
    else console.log("MISS:", query, "→", got);
  }
  assert.ok(hits / probes.length >= 0.9, `accuracy ${(hits / probes.length) * 100}%`);
});
