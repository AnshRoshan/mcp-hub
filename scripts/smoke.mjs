#!/usr/bin/env node
/**
 * End-to-end smoke test for MCP Workstation.
 *
 * Builds nothing — run `npm run build` first (or `npm test`, which does).
 * Spawns the built server on a random port with a throwaway data dir,
 * connects with the v2 client, and exercises the key features:
 * discover/listTools, tool calls, memory persistence, and the knowledge
 * base (full-text + vector search).
 *
 * Exit code 0 = all good, 1 = something failed.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4100 + Math.floor(Math.random() * 400);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "mcp-ws-smoke-"));
const baseUrl = `http://localhost:${port}/mcp`;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✔" : "  ✖"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      // Any HTTP response (even an error body) means the server is listening.
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start in time");
}

const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    MEMORY_FILE: path.join(dataDir, "memory.json"),
    SQLITE_PATH: path.join(dataDir, "workstation.db"),
    KNOWLEDGE_DB: path.join(dataDir, "knowledge.db"),
    FILESYSTEM_ROOTS: path.join(dataDir, "workspace"),
    // This test exercises single-user mode: force platform mode OFF even if
    // the developer's own .env sets BETTER_AUTH_SECRET (dotenv won't override
    // an already-set variable, so an explicit empty value wins).
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_URL: "",
    PUBLIC_BASE_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

let client;
try {
  await waitForServer(`http://localhost:${port}/mcp`);

  client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  check("listTools returns tools", names.length > 0, `${names.length} tools`);
  check("has uuid_generate", names.includes("uuid_generate"));
  check("has knowledge tools", ["knowledge_index", "knowledge_fts_search", "knowledge_vector_search", "knowledge_search"].every((t) => names.includes(t)));

  // server/discover over raw HTTP (stateless envelope) + cache hints
  const discoRes = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
      "Mcp-Name": "server/discover",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "smoke", version: "1.0" },
        },
      },
    }),
  });
  const discoJson = await discoRes.json();
  const discoOk =
    discoJson.result?.supportedVersions?.includes("2026-07-28") &&
    discoJson.result?.ttlMs != null &&
    discoJson.result?.cacheScope === "public";
  check("server/discover + cache hints", discoOk, JSON.stringify(discoJson.result ?? discoJson.error).slice(0, 100));

  const time = await client.callTool({ name: "get_current_time", arguments: { timezone: "UTC" } });
  check("get_current_time", time.content?.some((c) => c.type === "text" && /20\d\d-\d\d-\d\d/.test(c.text)));

  await client.callTool({ name: "memory_set", arguments: { key: "smoke", value: "hello" } });
  const mem = await client.callTool({ name: "memory_get", arguments: { key: "smoke" } });
  const memText = mem.content?.[0]?.text ?? "";
  check("memory persistence", memText.includes("hello"), memText);

  await client.callTool({
    name: "knowledge_index",
    arguments: { text: "Cats are independent pets that purr. Kittens love yarn.", title: "Cats" },
  });
  await client.callTool({
    name: "knowledge_index",
    arguments: { text: "TypeScript is a typed superset of JavaScript for building applications.", title: "TS" },
  });

  const fts = await client.callTool({ name: "knowledge_fts_search", arguments: { query: "javascript" } });
  const ftsText = fts.content?.[0]?.text ?? "";
  check("knowledge FTS search", ftsText.includes("TS"), ftsText.slice(0, 60));

  const vec = await client.callTool({ name: "knowledge_vector_search", arguments: { query: "feline companions that purr" } });
  const vecText = vec.content?.[0]?.text ?? "";
  check("knowledge vector search (semantic)", vecText.includes("Cats"), vecText.slice(0, 80));

  await client.close();
  client = null;
  check("modern stateless flow works", true, `http://localhost:${port}/mcp`);
} catch (err) {
  console.error(`  ✖ unexpected error: ${err instanceof Error ? err.message : err}`);
  failed++;
} finally {
  if (client) await client.close().catch(() => {});
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log(failed === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED (${failed} failure(s))`);
process.exit(failed === 0 ? 0 : 1);
