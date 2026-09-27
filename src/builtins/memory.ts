import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import type { StorageScope } from "../scope.js";
import { jsonResult, textResult } from "../result.js";
import { str } from "../utils.js";

type Store = Record<string, string>;

const stores = new Map<string, Store>();

/**
 * One store per file, memoized by path. Two live stores over the same file
 * would each hold their own copy and clobber the other's whole-file save, so
 * every catalog sharing a scope must share the store instance too.
 */
function storeFor(file: string): Store {
  let store = stores.get(file);
  if (!store) {
    store = load(file);
    stores.set(file, store);
  }
  return store;
}

// Prototype-less: with a plain object, `memory_set("__proto__", ...)` would
// write onto the shared prototype chain instead of storing an entry.
function load(file: string): Store {
  const store = Object.create(null) as Store;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Rebuild through the string filter: a hand-edited file with non-string
        // values would otherwise blow up memory_search's .toLowerCase() calls.
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") store[k] = v;
        }
      }
    }
  } catch (err) {
    console.error(`[memory] could not load ${file}: ${err instanceof Error ? err.message : err}`);
  }
  return store;
}

function save(file: string, store: Store): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
}

/** The `memory_*` tools bound to one scope's store file. */
export function memoryDefs(scope: StorageScope): ToolDef[] {
  const file = scope.memoryFile;
  const store = storeFor(file);
  return [
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
        save(file, store);
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
        save(file, store);
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
        // Emptied in place: the instance is shared through `stores`, so
        // reassigning would orphan the other holders of this store.
        for (const k of Object.keys(store)) delete store[k];
        save(file, store);
        return textResult("Memory cleared.");
      },
    },
  ];
}
