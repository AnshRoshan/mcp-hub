import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const saved = { ...process.env };
after(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

function serversFile(entries: unknown[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcw-cfg-")), "servers.json");
  fs.writeFileSync(file, JSON.stringify({ servers: entries }));
  return file;
}

test("missing servers file yields no upstreams and sane defaults", () => {
  process.env.MCP_WORKSTATION_SERVERS = path.join(os.tmpdir(), "does-not-exist-" + Date.now() + ".json");
  delete process.env.PORT;
  delete process.env.MCP_PATH;
  const cfg = loadConfig();
  assert.deepEqual(cfg.upstreamServers, []);
  assert.equal(cfg.port, 3125);
  assert.equal(cfg.mcpPath, "/mcp");
  assert.ok(Array.isArray(cfg.filesystemRoots) && cfg.filesystemRoots.length >= 1);
});

test("unparseable servers file is skipped, not fatal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcw-cfg-"));
  const file = path.join(dir, "servers.json");
  fs.writeFileSync(file, "{ not json");
  process.env.MCP_WORKSTATION_SERVERS = file;
  assert.deepEqual(loadConfig().upstreamServers, []);
});

test("entries are parsed, validated, and bad ones skipped", () => {
  process.env.MCP_WORKSTATION_SERVERS = serversFile([
    { key: " box ", type: "stdio", command: "npx", args: ["-y", "srv"], env: { TOKEN: "x" }, cwd: "/tmp" },
    { key: "api", type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
    { key: "off", enabled: false, type: "http", url: "https://x" },
    { type: "http", url: "https://no-key" },
    { key: "bad-type", type: "grpc", url: "https://x" },
    null,
    "junk",
  ]);
  const servers = loadConfig().upstreamServers;
  assert.equal(servers.length, 2);
  assert.deepEqual(servers[0], {
    key: "box",
    type: "stdio",
    command: "npx",
    args: ["-y", "srv"],
    env: { TOKEN: "x" },
    cwd: "/tmp",
  });
  assert.deepEqual(servers[1], {
    key: "api",
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer x" },
  });
});

test("stdio entry without command and http without url are skipped", () => {
  process.env.MCP_WORKSTATION_SERVERS = serversFile([
    { key: "a", type: "stdio" },
    { key: "b", type: "http" },
    { key: "c", type: "http", url: "https://ok" },
  ]);
  const servers = loadConfig().upstreamServers;
  assert.equal(servers.length, 1);
  assert.equal(servers[0].key, "c");
});

test("env overrides for port, mcpPath, and file paths", () => {
  process.env.PORT = "8080";
  process.env.MCP_PATH = "/gateway";
  process.env.SQLITE_PATH = "custom/db.sqlite";
  process.env.MEMORY_FILE = "custom/mem.json";
  process.env.MCP_WORKSTATION_SERVERS = path.join(os.tmpdir(), "nope.json");
  const cfg = loadConfig();
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.mcpPath, "/gateway");
  assert.equal(cfg.sqlitePath, path.resolve(process.cwd(), "custom/db.sqlite"));
  assert.equal(cfg.memoryFile, path.resolve(process.cwd(), "custom/mem.json"));
});

test("invalid PORT falls back to the default", () => {
  process.env.PORT = "not-a-number";
  process.env.MCP_WORKSTATION_SERVERS = path.join(os.tmpdir(), "nope.json");
  assert.equal(loadConfig().port, 3125);
  process.env.PORT = "-5";
  assert.equal(loadConfig().port, 3125);
});
