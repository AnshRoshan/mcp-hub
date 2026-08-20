import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../registry.js";
import { jsonResult, textResult } from "../result.js";
import { env, str } from "../utils.js";

const DEFAULT_ROOT = path.resolve(process.cwd(), "data", "workspace");

export const filesystemRoots: string[] = env("FILESYSTEM_ROOTS")
  ? env("FILESYSTEM_ROOTS")!.split(",").map((s) => s.trim()).filter(Boolean).map((r) => path.resolve(process.cwd(), r))
  : [DEFAULT_ROOT];

for (const root of filesystemRoots) {
  fs.mkdirSync(root, { recursive: true });
}

/**
 * Resolve a user-supplied path inside the sandbox, throwing if it escapes.
 * Relative paths are resolved against the first configured root.
 */
export function resolveInside(rel: string): string {
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(filesystemRoots[0] ?? DEFAULT_ROOT, rel);
  const inside = filesystemRoots.some((root) => {
    const r = path.resolve(root);
    return abs === r || abs.startsWith(r + path.sep);
  });
  if (!inside) {
    throw new Error(`Path "${rel}" is outside the allowed roots (${filesystemRoots.join(", ")})`);
  }
  return abs;
}

export const filesystemDefs: ToolDef[] = [
  {
    name: "fs_read",
    description: "Read a text file inside the sandboxed workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path (relative to a configured root, or absolute)" } },
      required: ["path"],
    },
    handler: (args) => {
      const abs = resolveInside(str(args.path));
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
      const abs = resolveInside(str(args.path));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const append = args.append === true || str(args.append).toLowerCase() === "true";
      fs.writeFileSync(abs, str(args.content), { encoding: "utf-8", flag: append ? "a" : "w" });
      return textResult(`${append ? "Appended to" : "Wrote"} ${args.path} (${str(args.content).length} chars).`);
    },
  },
  {
    name: "fs_list",
    description: "List the contents of a directory (files and folders) inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path; defaults to the first root" } },
    },
    handler: (args) => {
      const abs = resolveInside(str(args.path, filesystemRoots[0] ?? DEFAULT_ROOT));
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
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: (args) => {
      const abs = resolveInside(str(args.path));
      fs.mkdirSync(abs, { recursive: true });
      return textResult(`Created directory ${args.path}.`);
    },
  },
  {
    name: "fs_remove",
    description: "Delete a file or directory (recursively) inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: (args) => {
      const abs = resolveInside(str(args.path));
      if (!fs.existsSync(abs)) throw new Error(`Not found: ${args.path}`);
      fs.rmSync(abs, { recursive: true, force: true });
      return textResult(`Removed ${args.path}.`);
    },
  },
  {
    name: "fs_stat",
    description: "Show metadata (size, times, type) for a file or directory.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: (args) => {
      const abs = resolveInside(str(args.path));
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
    handler: (args) => {
      const abs = resolveInside(str(args.path, filesystemRoots[0] ?? DEFAULT_ROOT));
      let re: RegExp;
      try {
        re = new RegExp(str(args.pattern));
      } catch (err) {
        throw new Error(`Invalid regex: ${err instanceof Error ? err.message : err}`);
      }
      const max = Math.min(Math.max(Number(args.max_matches) || 200, 1), 500);
      const matches: { file: string; line: number; text: string }[] = [];

      const walk = (dir: string): void => {
        if (matches.length >= max) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (matches.length >= max) return;
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            let content: string;
            try {
              content = fs.readFileSync(full, "utf-8");
            } catch {
              continue; // binary/unreadable
            }
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && matches.length < max; i++) {
              if (re.test(lines[i])) {
                matches.push({ file: full, line: i + 1, text: lines[i].slice(0, 300) });
              }
            }
          }
        }
      };
      walk(abs);
      return jsonResult({ pattern: str(args.pattern), count: matches.length, matches });
    },
  },
];
