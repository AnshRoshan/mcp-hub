import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ToolDef } from "../src/registry.js";
import type { StorageScope } from "../src/scope.js";
import { defaultScope, userScope } from "../src/scope.js";
import { memoryDefs } from "../src/builtins/memory.js";
import { filesystemDefs, sandboxFor } from "../src/builtins/filesystem.js";

const saved = { ...process.env };
after(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcw-scope-"));

/** A scope rooted at `name` — the shape the server hands to a scoped module. */
function scopeAt(name: string): StorageScope {
  const dataDir = path.join(TMP, name);
  const filesystemRoots = [path.join(dataDir, "workspace")];
  return {
    dataDir,
    filesystemRoots,
    memoryFile: path.join(dataDir, "memory.json"),
    knowledgeDb: path.join(dataDir, "knowledge.db"),
    sqlitePath: path.join(dataDir, "workstation.db"),
    resultsDir: path.join(filesystemRoots[0], "results"),
  };
}

function find(defs: ToolDef[], name: string): ToolDef {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`tool ${name} not built`);
  return def;
}

function call(defs: ToolDef[], name: string, args: Record<string, unknown>): string {
  const out = find(defs, name).handler(args) as CallToolResult;
  return (out.content as { text?: string }[]).map((c) => c.text ?? "").join("");
}

test("defaultScope keeps today's env-driven single-user paths", () => {
  process.env.MEMORY_FILE = "custom/mem.json";
  process.env.KNOWLEDGE_DB = "custom/k.db";
  process.env.SQLITE_PATH = "custom/ws.db";
  process.env.FILESYSTEM_ROOTS = " custom/a , custom/b ,, ";
  const s = defaultScope();
  const cwd = process.cwd();
  assert.equal(s.memoryFile, path.resolve(cwd, "custom/mem.json"));
  assert.equal(s.knowledgeDb, path.resolve(cwd, "custom/k.db"));
  assert.equal(s.sqlitePath, path.resolve(cwd, "custom/ws.db"));
  assert.deepEqual(s.filesystemRoots, [path.resolve(cwd, "custom/a"), path.resolve(cwd, "custom/b")]);
  assert.equal(s.resultsDir, path.resolve(cwd, "custom/a/results"));
  assert.equal(s.dataDir, path.resolve(cwd, "custom"));
});

test("defaultScope falls back to the data/ layout", () => {
  delete process.env.MEMORY_FILE;
  delete process.env.KNOWLEDGE_DB;
  delete process.env.SQLITE_PATH;
  delete process.env.FILESYSTEM_ROOTS;
  const s = defaultScope();
  const data = path.resolve(process.cwd(), "data");
  assert.equal(s.memoryFile, path.join(data, "memory.json"));
  assert.equal(s.knowledgeDb, path.join(data, "knowledge.db"));
  assert.equal(s.sqlitePath, path.join(data, "workstation.db"));
  assert.deepEqual(s.filesystemRoots, [path.join(data, "workspace")]);
});

test("userScope puts each account in its own directory under users/", () => {
  const a = userScope(path.join(TMP, "platform"), "usr_alice");
  const b = userScope(path.join(TMP, "platform"), "usr_bob");
  assert.equal(a.dataDir, path.join(TMP, "platform", "users", "usr_alice"));
  assert.notEqual(a.memoryFile, b.memoryFile);
  assert.notEqual(a.knowledgeDb, b.knowledgeDb);
  assert.notEqual(a.sqlitePath, b.sqlitePath);
  assert.notEqual(a.filesystemRoots[0], b.filesystemRoots[0]);
  assert.equal(a.resultsDir, path.join(a.dataDir, "workspace", "results"));
});

test("userScope cannot be walked out of users/ by an hostile id", () => {
  const root = path.join(TMP, "platform");
  const under = path.join(root, "users") + path.sep;
  for (const hostile of ["../../evil", "..", ".", "/etc/passwd", "a\\b", "usr_ok"]) {
    const dir = userScope(root, hostile).dataDir;
    assert.ok(dir.startsWith(under), `${hostile} → ${dir}`);
  }
  // A pure dot-run collapses instead of becoming a traversal segment.
  assert.equal(path.basename(userScope(root, "..").dataDir), "unknown");
  // Separators are neutralised, so the id stays a single path segment.
  assert.equal(path.basename(userScope(root, "../../evil").dataDir), ".._.._evil");
});

test("memory modules built for different scopes hold different entries", () => {
  const a = scopeAt("mem-a");
  const aAgain = scopeAt("mem-a");
  const b = scopeAt("mem-b");
  call(memoryDefs(a), "memory_set", { key: "token", value: "alice-secret" });
  // Same file → same instance, so the write is visible to the next catalog.
  assert.equal(call(memoryDefs(aAgain), "memory_get", { key: "token" }), "alice-secret");
  assert.equal(call(memoryDefs(b), "memory_get", { key: "token" }), "No entry for \"token\".");
  assert.equal(call(memoryDefs(b), "memory_list", {}), "Memory is empty.");
  assert.equal(call(memoryDefs(b), "memory_search", { query: "alice" }), "No matches.");
  // The store is prototype-less, so a `__proto__` key is an entry, not a leak.
  call(memoryDefs(a), "memory_set", { key: "__proto__", value: "x" });
  assert.equal(call(memoryDefs(aAgain), "memory_get", { key: "__proto__" }), "x");
  assert.equal(({} as Record<string, string>).polluted, undefined);
  // A hand-edited file with non-string values must not break searching.
  const edited = scopeAt("mem-edited");
  fs.mkdirSync(edited.dataDir, { recursive: true });
  fs.writeFileSync(edited.memoryFile, JSON.stringify({ ok: "yes", n: 7, obj: { a: 1 } }));
  assert.equal(call(memoryDefs(edited), "memory_list", {}), "ok = yes");
  assert.equal(call(memoryDefs(aAgain), "memory_clear", {}), "Memory cleared.");
  assert.equal(call(memoryDefs(aAgain), "memory_list", {}), "Memory is empty.");
});

test("filesystem sandboxes resolve inside their own scope only", () => {
  const a = scopeAt("fs-a");
  const b = scopeAt("fs-b");
  call(filesystemDefs(a), "fs_write", { path: "notes.txt", content: "alice was here" });
  const aliceFile = path.join(a.filesystemRoots[0], "notes.txt");
  // Bob's relative path is his own file…
  call(filesystemDefs(b), "fs_write", { path: "notes.txt", content: "bob" });
  assert.equal(call(filesystemDefs(b), "fs_read", { path: "notes.txt" }), "bob");
  assert.equal(call(filesystemDefs(a), "fs_read", { path: "notes.txt" }), "alice was here");
  // …and naming Alice's absolute path is refused, not read.
  assert.throws(() => sandboxFor(b).resolveInside(aliceFile), /outside the allowed roots/);
  assert.throws(() => call(filesystemDefs(b), "fs_read", { path: aliceFile }), /outside the allowed roots/);
  const listed = JSON.parse(call(filesystemDefs(b), "fs_list", {})) as { name: string }[];
  assert.deepEqual(listed.map((e) => e.name), ["notes.txt"]);
  const aliceListed = JSON.parse(call(filesystemDefs(a), "fs_list", {})) as { name: string }[];
  assert.deepEqual(aliceListed.map((e) => e.name), ["notes.txt"]);
});

test("a link inside a sandbox cannot carry a read out of it", (t) => {
  const a = scopeAt("link-a");
  const b = scopeAt("link-b");
  filesystemDefs(b); // creates Bob's root
  filesystemDefs(a);
  const outside = path.join(TMP, "secret-outside.txt");
  fs.writeFileSync(outside, "do not read");
  const link = path.join(b.filesystemRoots[0], "escape");
  try {
    fs.symlinkSync(outside, link);
  } catch {
    t.skip("symlinks unavailable on this platform");
    return;
  }
  assert.throws(() => sandboxFor(b).resolveInside(link), /through a link outside the allowed roots/);
});

test("sqlite binds one read-only database per scope", async () => {
  // Read-only is the default, and `SQLITE_ALLOW_WRITE` is captured at import,
  // so this file must never flip it.
  delete process.env.SQLITE_ALLOW_WRITE;
  const { sqliteModule } = await import("../src/builtins/sqlite.js");
  const { DatabaseSync } = await import("node:sqlite");

  const a = scopeAt("sql-a");
  const b = scopeAt("sql-b");
  const fresh = scopeAt("sql-fresh");
  fs.mkdirSync(path.dirname(a.sqlitePath), { recursive: true });
  new DatabaseSync(a.sqlitePath).exec("CREATE TABLE alice_t (x INTEGER)");

  const ma = sqliteModule(a);
  const mb = sqliteModule(b);
  const mf = sqliteModule(fresh);
  assert.equal(ma.enabled, true, ma.reason);
  assert.equal(mb.enabled, true, mb.reason);
  assert.equal(mf.enabled, true, mf.reason);

  const tablesOf = (mod: { defs: ToolDef[] }): string[] =>
    JSON.parse(call(mod.defs, "sqlite_list_tables", {})) as string[];
  assert.ok(tablesOf(ma).includes("alice_t"), tablesOf(ma).join(","));
  assert.ok(!tablesOf(mb).includes("alice_t"), tablesOf(mb).join(","));
  // A read-only handle cannot create its file, so a missing database must be
  // bootstrapped empty before it is reopened under the read-only flag.
  assert.ok(fs.existsSync(fresh.sqlitePath));
  assert.deepEqual(tablesOf(mf), []);

  assert.throws(() => call(ma.defs, "sqlite_execute", { sql: "CREATE TABLE t2 (x INTEGER)" }), /writes are disabled/);
  assert.throws(() => call(ma.defs, "sqlite_query", { sql: "DROP TABLE alice_t" }), /read-only mode/);
  assert.ok(tablesOf(ma).includes("alice_t"), "the read-only database must be unchanged");
});
