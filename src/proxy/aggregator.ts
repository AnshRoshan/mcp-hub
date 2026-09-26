import type { CallToolResult } from "@modelcontextprotocol/client";
import type { UpstreamServerConfig } from "../config.js";
import { UpstreamServer, type ProxiedTool, type ProxiedResource } from "./upstream.js";

export interface UpstreamSummary {
  key: string;
  type: "stdio" | "http";
  detail: string;
  state: "connected" | "error";
  toolCount: number;
  resourceCount?: number;
  error?: string;
}

/** A resource plus the closure that reads it from its owning upstream. */
export interface ProxiedResourceEntry {
  resource: ProxiedResource;
  read: () => Promise<unknown>;
}

export class UpstreamAggregator {
  private servers: UpstreamServer[] = [];

  /** Connect (or reconnect) all upstream servers from config. Safe to call repeatedly. */
  async connectAll(configs: UpstreamServerConfig[]): Promise<void> {
    await this.disconnectAll();
    // Concurrent: a serial loop meant one unreachable upstream stalled every
    // server behind it by its full connect timeout. connectOne never rejects.
    await Promise.all(configs.map((config) => this.connectOne(config)));
  }

  /** Instantiate, register, and connect a single upstream; logs the outcome either way. */
  private async connectOne(config: UpstreamServerConfig, reconnecting = false): Promise<void> {
    const server = new UpstreamServer(config);
    this.servers.push(server);
    try {
      await server.connect();
      console.error(`[mcp-workstation]   ✔ ${config.key}${reconnecting ? " (reconnected)" : ""}: ${server.tools.length} tools`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      server.status = { state: "error", error: message };
      console.error(`[mcp-workstation]   ✖ ${config.key}${reconnecting ? " (reconnect failed)" : ""}: ${message}`);
    }
  }

  async disconnectAll(): Promise<void> {
    const closing = this.servers.map((s) => s.close());
    this.servers = [];
    await Promise.allSettled(closing);
  }

  /** Proxied tools across all connected servers, first-wins on a name clash. */
  allTools(): ProxiedTool[] {
    const seen = new Set<string>();
    const out: ProxiedTool[] = [];
    for (const tool of this.servers.flatMap((s) => s.tools)) {
      if (seen.has(tool.name)) {
        // Routing resolves to the first owner (see find()), so advertising a
        // duplicate would promise a tool no call can ever reach.
        console.error(`[mcp-workstation] tool name collision, dropping: ${tool.name}`);
        continue;
      }
      seen.add(tool.name);
      out.push(tool);
    }
    return out;
  }

  /** All proxied resources across connected servers, first-wins on URI clash. */
  allResources(): ProxiedResourceEntry[] {
    const byUri = new Map<string, ProxiedResourceEntry>();
    for (const server of this.servers) {
      for (const resource of server.resources) {
        if (byUri.has(resource.uri)) {
          console.error(`[mcp-workstation] resource URI collision, keeping first: ${resource.uri}`);
          continue;
        }
        const owning = server;
        byUri.set(resource.uri, { resource, read: () => owning.readResource(resource.uri) });
      }
    }
    return [...byUri.values()];
  }

  /** Find which server owns a namespaced tool name. */
  private find(name: string): { server: UpstreamServer; tool: ProxiedTool } | undefined {
    for (const server of this.servers) {
      const tool = server.tools.find((t) => t.name === name);
      if (tool) return { server, tool };
    }
    return undefined;
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const found = this.find(name);
    if (!found) {
      throw new Error(`Unknown tool "${name}". Run workstation_status to see available tools.`);
    }
    if (found.server.status.state !== "connected") {
      throw new Error(`Upstream server "${found.server.key}" is not connected.`);
    }
    return found.server.call(found.tool.originalName, args);
  }

  /** Reconnect a single server by key with a fresh config. */
  async reconnect(key: string, config: UpstreamServerConfig): Promise<void> {
    const idx = this.servers.findIndex((s) => s.key === key);
    if (idx >= 0) {
      await this.servers[idx].close();
      this.servers.splice(idx, 1);
    }
    await this.connectOne(config, true);
  }

  /** Get the current connection state of a server by key. */
  /** Live check against one upstream; false for unknown, unconnected or dead. */
  async probe(key: string, timeoutMs: number): Promise<boolean> {
    const s = this.servers.find((srv) => srv.key === key);
    if (!s) return false;
    try {
      await s.ping(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  summaries(): UpstreamSummary[] {
    return this.servers.map((s) => ({
      key: s.key,
      type: s.config.type,
      detail:
        s.config.type === "stdio"
          ? `${s.config.command} ${(s.config.args ?? []).join(" ")}`.trim()
          : s.config.url,
      state: s.status.state,
      toolCount: s.status.state === "connected" ? s.status.toolCount : 0,
      resourceCount: s.resources.length,
      error: s.status.state === "error" ? s.status.error : undefined,
    }));
  }
}
