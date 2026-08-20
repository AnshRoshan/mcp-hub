import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import { jsonResult, textResult } from "../result.js";
import { env, str } from "../utils.js";

const MEMORY_FILE = env("MEMORY_FILE")
  ? path.resolve(process.cwd(), env("MEMORY_FILE")!)
  : path.resolve(process.cwd(), "data", "memory.json");

type Store = Record<string, string>;

let store: Store = {};
function load(): void {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store = parsed as Store;
      }
    }
  } catch (err) {
    console.error(`[memory] could not load ${MEMORY_FILE}: ${err instanceof Error ? err.message : err}`);
  }
}
function save(): void {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
}
load();

export const memoryDefs: ToolDef[] = [
  {
    name: "memory_set",
    description: "Store a value under a key in persistent memory (survives restarts).",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string", description: "The value to remember" },
      },
      required: ["key", "value"],
    },
    handler: (args) => {
      const key = str(args.key);
      if (!key) throw new Error("`key` is required");
      store[key] = str(args.value);
      save();
      return textResult(`Saved "${key}".`);
    },
  },
  {
    name: "memory_get",
    description: "Read a value from memory by key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: (args) => {
      const key = str(args.key);
      const value = store[key];
      return value === undefined ? textResult(`No entry for "${key}".`) : textResult(value);
    },
  },
  {
    name: "memory_delete",
    description: "Delete a key from memory.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: (args) => {
      const key = str(args.key);
      const existed = key in store;
      delete store[key];
      save();
      return textResult(existed ? `Deleted "${key}".` : `No entry for "${key}".`);
    },
  },
  {
    name: "memory_list",
    description: "List all keys currently stored in memory.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const keys = Object.keys(store).sort();
      if (keys.length === 0) return textResult("Memory is empty.");
      return textResult(keys.map((k) => `${k} = ${store[k]}`).join("\n"));
    },
  },
  {
    name: "memory_search",
    description: "Case-insensitive substring search across memory keys and values.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: (args) => {
      const q = str(args.query).toLowerCase();
      const hits = Object.entries(store).filter(
        ([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
      );
      if (hits.length === 0) return textResult("No matches.");
      return jsonResult(Object.fromEntries(hits));
    },
  },
  {
    name: "memory_clear",
    description: "Wipe all entries from memory.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      store = {};
      save();
      return textResult("Memory cleared.");
    },
  },
];
