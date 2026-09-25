import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * A tool definition. `inputSchema` is a JSON Schema object (the MCP-native
 * representation), so it can pass through proxied upstream schemas unchanged.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult;
  /** Verbatim tool-level `_meta` (MCP Apps, icons, vendor extensions) — upstream tools only. */
  _meta?: Record<string, unknown>;
  title?: string;
}

export interface ModuleInfo {
  name: string;
  category: string;
  enabled: boolean;
  reason?: string;
  toolCount: number;
  tools: string[];
}

/** Tool map — a fresh instance is built per catalog, never mutated after assembly. */
export class ToolRegistry {
  private _tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    this._tools.set(def.name, def);
  }

  entries(): ToolDef[] {
    return [...this._tools.values()];
  }
}

/** Register a module's tools into the registry, or record why it was skipped. */
export interface RegisterModuleOpts {
  name: string;
  category: string;
  enabled: boolean;
  reason?: string;
  defs: ToolDef[];
}

export function registerModule(
  registry: ToolRegistry,
  info: ModuleInfo[],
  name: string,
  opts: RegisterModuleOpts,
): void {
  if (!opts.enabled) {
    info.push({
      name,
      category: opts.category,
      enabled: false,
      reason: opts.reason ?? "disabled",
      toolCount: 0,
      tools: opts.defs.map((d) => d.name),
    });
    return;
  }
  for (const def of opts.defs) {
    registry.register(def);
  }
  info.push({
    name,
    category: opts.category,
    enabled: true,
    toolCount: opts.defs.length,
    tools: opts.defs.map((d) => d.name),
  });
}
