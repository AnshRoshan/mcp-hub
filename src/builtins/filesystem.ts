import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import type { StorageScope } from "../scope.js";
import { jsonResult, textResult } from "../result.js";
import { str } from "../utils.js";
import { runBounded } from "../bounded.js";

/** Ceiling on a grep before it is killed; caller regexes are untrusted. */
const GREP_TIMEOUT_MS = Math.max(Number(process.env.FS_SEARCH_TIMEOUT_MS ?? "") || 5000, 250);

/** A sandbox: the roots one scope may touch, plus its containment resolver. */
export interface Sandbox {
  roots: string[];
  /** Resolve a user-supplied path inside these roots, throwing if it escapes. */
  resolveInside(rel: string): string;
}

const sandboxes = new Map<string, Sandbox>();

/**
 * The sandbox for a scope, memoized by its roots. Both the `fs_*` tools and
 * knowledge's workspace indexer must resolve through the SAME instance: the
 * real-path containment check is only as good as the roots it captured, and a
 * second instance would re-mkdir and re-realpath on every catalog build.
 */
export function sandboxFor(scope: StorageScope): Sandbox {
  const key = scope.filesystemRoots.join("|");
  let sandbox = sandboxes.get(key);
  if (!sandbox) {
    sandbox = createSandbox(scope.filesystemRoots);
    sandboxes.set(key, sandbox);
  }
  return sandbox;
}

function createSandbox(roots: string[]): Sandbox {
  for (const root of roots) {
    fs.mkdirSync(root, { recursive: true });
  }
  /** Roots as the filesystem actually sees them, so comparison is not fooled by links. */
  const realRoots = roots.map((root) => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  });

  function withinRoots(candidate: string): boolean {
    return realRoots.some((root) => candidate === root || candidate.startsWith(root + path.sep));
  }

  /**
   * Relative paths are resolved against the first root.
   *
   * A lexical check alone is not containment: a symlink created inside a root
   * would otherwise send reads, writes and the recursive delete anywhere on the
   * host — or into another tenant's directory. So the deepest existing ancestor
   * is resolved through the real filesystem and re-checked against THIS scope's
   * roots; the target itself may legitimately not exist yet.
   */
  function resolveInside(rel: string): string {
    const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(roots[0], rel);
    if (!withinRoots(abs)) {
      throw new Error(`Path "${rel}" is outside the allowed roots (${roots.join(", ")})`);
    }
    let probe = abs;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const real = fs.realpathSync(probe);
    if (!withinRoots(real)) {
      throw new Error(`Path "${rel}" reaches the filesystem through a link outside the allowed roots`);
    }
    return abs;
  }

  return { roots, resolveInside };
}

/** The `fs_*` tools bound to one scope's sandbox. */
export function filesystemDefs(scope: StorageScope): ToolDef[] {
  const sandbox = sandboxFor(scope);
  const defaultRoot = sandbox.roots[0];
  // Detached on purpose: resolveInside is a closure over this scope's roots,
  // not a method, so calling it unbound still sandboxes to the right tenant.
  const resolve = sandbox.resolveInside;
  return [
    {
      name: "fs_read",
      description: "Read a text file inside the sandboxed workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Path (relative to a configured root, or absolute)" } },
        required: ["path"],
      },
      handler: (args) => {
        const abs = resolve(str(args.path));
        if (!fs.existsSync(abs)) throw new Error(`File not found: ${args.path}`);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) throw new Error(`${args.path} is a directory`);
        return textResult(fs.readFileSync(abs, "utf-8"));
      },
    },
    {
      name: "fs_write",
      description: "Write (or append to) a text file inside the sandboxed workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          append: { type: "boolean", description: "Append instead of overwrite (default false)" },
        },
        required: ["path", "content"],
      },
      handler: (args) => {
        const abs = resolve(str(args.path));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const append = args.append === true || str(args.append).toLowerCase() === "true";
        fs.writeFileSync(abs, str(args.content), { encoding: "utf-8", flag: append ? "a" : "w" });
        return textResult(`${append ? "Appended to" : "Wrote"} ${args.path} (${str(args.content).length} chars).`);
      },
    },
    {
      name: "fs_list",
      description: "List the contents of a directory (files and folders) inside the workspace.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Directory path; defaults to the first root" } } },
      handler: (args) => {
        const abs = resolve(str(args.path, defaultRoot));
        const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => {
          const full = path.join(abs, e.name);
          let size: number | null = null;
          try {
            if (e.isFile()) size = fs.statSync(full).size;
          } catch {
            // ignore stat errors (broken symlinks etc.)
          }
          return { name: e.name, type: e.isDirectory() ? "directory" : "file", size };
        });
        return jsonResult(entries);
      },
    },
    {
      name: "fs_mkdir",
      description: "Create a directory (recursively) inside the workspace.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: (args) => {
        const abs = resolve(str(args.path));
        fs.mkdirSync(abs, { recursive: true });
        return textResult(`Created directory ${args.path}.`);
      },
    },
    {
      name: "fs_remove",
      description: "Delete a file or directory (recursively) inside the workspace.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: (args) => {
        const abs = resolve(str(args.path));
        if (!fs.existsSync(abs)) throw new Error(`Not found: ${args.path}`);
        fs.rmSync(abs, { recursive: true, force: true });
        return textResult(`Removed ${args.path}.`);
      },
    },
    {
      name: "fs_stat",
      description: "Show metadata (size, times, type) for a file or directory.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: (args) => {
        const abs = resolve(str(args.path));
        const stat = fs.statSync(abs);
        return jsonResult({
          path: args.path,
          type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
          size: stat.size,
          created: stat.birthtime,
          modified: stat.mtime,
        });
      },
    },
    {
      name: "fs_search",
      description: "Recursively search files for a regular expression and return matching lines.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to search; defaults to the first root" },
          pattern: { type: "string", description: "Regular expression" },
          max_matches: { type: "integer", minimum: 1, maximum: 500, description: "Cap on matches (default 200)" },
        },
        required: ["pattern"],
      },
      handler: async (args) => {
        const abs = resolve(str(args.path, defaultRoot));
        const pattern = str(args.pattern);
        try {
          new RegExp(pattern);
        } catch (err) {
          throw new Error(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`);
        }
        const max = Math.min(Math.max(Number(args.max_matches) || 200, 1), 500);
        // Walked and matched on a bounded worker thread: a caller-supplied
        // regex can be catastrophic, and a hung scan on the main thread stops
        // the whole server for every user, not just this request.
        const source = `
          const fs = require("node:fs");
          const path = require("node:path");
          const { parentPort, workerData } = require("node:worker_threads");
          const { root, pattern, max } = workerData;
          const re = new RegExp(pattern);
          const matches = [];
          const walk = (dir) => {
            if (matches.length >= max) return;
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
              if (matches.length >= max) return;
              if (entry.name === "node_modules" || entry.name === ".git") continue;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) { walk(full); continue; }
              if (!entry.isFile()) continue;
              let content;
              try { content = fs.readFileSync(full, "utf-8"); } catch { continue; }
              const lines = content.split("\\n");
              for (let i = 0; i < lines.length && matches.length < max; i++) {
                if (re.test(lines[i])) matches.push({ file: full, line: i + 1, text: lines[i].slice(0, 300) });
              }
            }
          };
          walk(root);
          parentPort.postMessage(matches);
        `;
        const matches = await runBounded<{ file: string; line: number; text: string }[]>(
          source,
          { root: abs, pattern, max },
          { timeoutMs: GREP_TIMEOUT_MS, label: `File search for "${pattern}" timed out` },
        );
        return jsonResult({ pattern, count: matches.length, truncated: matches.length >= max, matches });
      },
    },
  ];
}
