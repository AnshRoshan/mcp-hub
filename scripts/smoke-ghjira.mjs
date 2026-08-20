#!/usr/bin/env node
/**
 * Integration test for the GitHub + Jira modules using a local mock API.
 * No real credentials needed — GITHUB_API_URL / JIRA_BASE_URL point at a
 * mock HTTP server that also validates the auth headers each module sends.
 *
 * Run: npm run build && node scripts/smoke-ghjira.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = 4290 + Math.floor(Math.random() * 100);
const WS_PORT = MOCK_PORT + 1;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "mcp-ws-ghjira-"));

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✔" : "  ✖"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

/* ---- mock GitHub + Jira API ---- */
const authErrors = [];
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${MOCK_PORT}`);
  const auth = req.headers.authorization ?? "";
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf-8");
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    /* ignore */
  }
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // GitHub-style endpoints
  if (url.pathname === "/user" || url.pathname.startsWith("/users/")) {
    if (auth !== "Bearer mock-token") authErrors.push(`GH /user auth was "${auth}"`);
    return send(200, { login: "mock-user", name: "Mock User", public_repos: 42 });
  }
  if (url.pathname.startsWith("/repos/")) {
    if (auth !== "Bearer mock-token") authErrors.push(`GH repo auth was "${auth}"`);
    if (url.pathname.endsWith("/issues") && req.method === "POST") {
      if (!body.title) return send(422, { message: "Validation Failed" });
      return send(201, { number: 7, title: body.title, state: "open", html_url: "http://mock/issues/7" });
    }
    if (url.pathname.endsWith("/issues") && req.method === "GET") {
      return send(200, [{ number: 7, title: "Fix the bug", state: "open" }]);
    }
    return send(200, { full_name: "mock/repo", default_branch: "main", stargazers_count: 123 });
  }
  if (url.pathname === "/rate_limit") {
    return send(200, { resources: { core: { limit: 5000, used: 10, remaining: 4990 } } });
  }

  // Jira-style endpoints
  if (url.pathname.endsWith("/rest/api/3/search") && req.method === "POST") {
    const expect = `Basic ${Buffer.from("a@b.com:jira-tok").toString("base64")}`;
    if (auth !== expect) authErrors.push(`Jira search auth was "${auth}"`);
    if (!body.jql) return send(400, { errorMessages: ["JQL is required"] });
    return send(200, {
      issues: [
        { key: "DEMO-1", fields: { summary: "Ship next level", status: { name: "In Progress" } } },
        { key: "DEMO-2", fields: { summary: "Fix bug", status: { name: "To Do" } } },
      ],
    });
  }
  if (url.pathname.match(/\/rest\/api\/3\/issue\/[^/]+\/transitions$/)) {
    if (req.method === "GET") return send(200, { transitions: [{ id: "11", name: "In Progress" }, { id: "31", name: "Done" }] });
    if (req.method === "POST") {
      const id = body.transition?.id;
      return id ? send(204, {}) : send(400, { errorMessages: ["transition required"] });
    }
  }
  if (url.pathname.match(/\/rest\/api\/3\/issue\/[^/]+$/)) {
    return send(200, { key: "DEMO-1", fields: { summary: "Ship next level", status: { name: "In Progress" } } });
  }
  if (url.pathname === "/rest/api/3/project/search") {
    return send(200, { values: [{ key: "DEMO", name: "Demo Project", projectTypeKey: "software" }] });
  }
  return send(404, { message: `mock: no route for ${req.method} ${url.pathname}` });
});

await new Promise((r) => mock.listen(MOCK_PORT, r));

/* ---- spawn workstation pointed at the mock ---- */
const ws = spawn(process.execPath, ["dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(WS_PORT),
    GITHUB_TOKEN: "mock-token",
    GITHUB_API_URL: `http://localhost:${MOCK_PORT}`,
    JIRA_BASE_URL: `http://localhost:${MOCK_PORT}`,
    JIRA_API_TOKEN: "jira-tok",
    JIRA_EMAIL: "a@b.com",
    MEMORY_FILE: path.join(dataDir, "memory.json"),
    SQLITE_PATH: path.join(dataDir, "ws.db"),
    KNOWLEDGE_DB: path.join(dataDir, "knowledge.db"),
    FILESYSTEM_ROOTS: path.join(dataDir, "workspace"),
    // Single-user mode for this test — force platform off even if the
    // developer's .env sets BETTER_AUTH_SECRET.
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_URL: "",
    PUBLIC_BASE_URL: "",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
ws.stderr.on("data", () => {});

let client;
try {
  const base = `http://localhost:${WS_PORT}/mcp`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  client = new Client({ name: "smoke-ghjira", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base)));

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  check("github tools present", names.includes("gh_create_issue") && names.includes("gh_merge_pull_request"), `${names.filter((n) => n.startsWith("gh_")).length} gh_* tools`);
  check("jira tools present", names.includes("jira_search_issues") && names.includes("jira_transition_issue"), `${names.filter((n) => n.startsWith("jira_")).length} jira_* tools`);

  const t = (name, args) => client.callTool({ name, arguments: args });
  const text = (r) => r.content?.[0]?.text ?? "";

  const user = await t("gh_get_user", {});
  check("gh_get_user", text(user).includes("mock-user"), text(user).slice(0, 60));

  const created = await t("gh_create_issue", { owner: "mock", repo: "repo", title: "Found a bug" });
  check("gh_create_issue", text(created).includes('"number": 7'), text(created).slice(0, 60));

  const rate = await t("gh_rate_limit", {});
  check("gh_rate_limit", text(rate).includes("4990"));

  const search = await t("jira_search_issues", { jql: "project = DEMO" });
  check("jira_search_issues", text(search).includes("DEMO-1") && text(search).includes("Ship next level"));

  const trans = await t("jira_list_transitions", { issue_key: "DEMO-1" });
  check("jira_list_transitions", text(trans).includes("In Progress"));

  const moved = await t("jira_transition_issue", { issue_key: "DEMO-1", transition: "In Progress" });
  check("jira_transition_issue", text(moved).includes("In Progress"), text(moved).slice(0, 60));

  const projects = await t("jira_list_projects", {});
  check("jira_list_projects", text(projects).includes("DEMO"));

  check("auth headers correct on both APIs", authErrors.length === 0, authErrors.join(" | "));

  await client.close();
  client = null;
} catch (err) {
  console.error(`  ✖ unexpected error: ${err instanceof Error ? err.message : err}`);
  failed++;
} finally {
  if (client) await client.close().catch(() => {});
  ws.kill();
  mock.close();
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(failed === 0 ? "\nGH + JIRA MOCK TEST PASSED" : `\nGH + JIRA MOCK TEST FAILED (${failed} failure(s))`);
process.exit(failed === 0 ? 0 : 1);
