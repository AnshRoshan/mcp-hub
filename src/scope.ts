import path from "node:path";
import { env } from "./utils.js";

/**
 * Server-assigned storage scope: which files the stateful builtin modules
 * (memory, filesystem, knowledge, sqlite) read and write for ONE catalog.
 *
 * Single-user mode resolves to the env-driven paths the project has always
 * used. Platform mode resolves to a per-account directory —
 * `<dir of PLATFORM_DB>/users/<userId>/` — so two tenants can never land on
 * the same memory file, sandbox, or database. The scope is computed by the
 * server from the authenticated user id; it is never taken from tool
 * arguments, prefs, or secrets.
 *
 * Per-user directories are created lazily by the modules that own the files.
 * Deleting an account removes its DB rows (the platform schema cascades) but
 * intentionally leaves `users/<id>/` on disk: wiping tenant data automatically
 * is destructive and out of scope here.
 */
export interface StorageScope {
  /** Directory holding this scope's state. */
  dataDir: string;
  /** Sandbox roots for the `fs_*` tools; never empty. */
  filesystemRoots: string[];
  memoryFile: string;
  knowledgeDb: string;
  sqlitePath: string;
  /** Where oversized tool results are spilled — always inside the sandbox. */
  resultsDir: string;
}

const DATA_DIR = path.resolve(process.cwd(), "data");

function envPath(name: string, fallback: string): string {
  const v = env(name);
  return v ? path.resolve(process.cwd(), v) : fallback;
}

function scope(dataDir: string, filesystemRoots: string[], files: { memoryFile: string; knowledgeDb: string; sqlitePath: string }): StorageScope {
  return { dataDir, filesystemRoots, ...files, resultsDir: path.join(filesystemRoots[0], "results") };
}

/** The operator's own paths: `MEMORY_FILE` / `FILESYSTEM_ROOTS` / `KNOWLEDGE_DB` / `SQLITE_PATH`. */
export function defaultScope(): StorageScope {
  const fromEnv = env("FILESYSTEM_ROOTS")
    ? env("FILESYSTEM_ROOTS")!.split(",").map((s) => s.trim()).filter(Boolean).map((r) => path.resolve(process.cwd(), r))
    : [];
  const filesystemRoots = fromEnv.length > 0 ? fromEnv : [path.join(DATA_DIR, "workspace")];
  const memoryFile = envPath("MEMORY_FILE", path.join(DATA_DIR, "memory.json"));
  return scope(path.dirname(memoryFile), filesystemRoots, {
    memoryFile,
    knowledgeDb: envPath("KNOWLEDGE_DB", path.join(DATA_DIR, "knowledge.db")),
    sqlitePath: envPath("SQLITE_PATH", path.join(DATA_DIR, "workstation.db")),
  });
}

/**
 * One account's scope under the platform data root (the directory holding
 * `platform.db`). `userId` is server-assigned, but it still becomes a path
 * segment, so it gets the same containment treatment as any other.
 */
export function userScope(dataRoot: string, userId: string): StorageScope {
  const dataDir = path.join(path.resolve(dataRoot), "users", safeSegment(userId));
  const filesystemRoots = [path.join(dataDir, "workspace")];
  return scope(dataDir, filesystemRoots, {
    memoryFile: path.join(dataDir, "memory.json"),
    knowledgeDb: path.join(dataDir, "knowledge.db"),
    sqlitePath: path.join(dataDir, "workstation.db"),
  });
}

/** Better Auth ids are opaque and already safe; never let one escape `users/`. */
function safeSegment(userId: string): string {
  const clean = userId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+$/, "");
  return clean || "unknown";
}
