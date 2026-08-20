import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import type { CacheHint, JsonSchemaType, McpHttpHandler, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { jsonResult } from "./result.js";
import { loadConfig, type WorkstationConfig, type UpstreamServerConfig } from "./config.js";
import { ToolRegistry, registerModule, type ModuleInfo } from "./registry.js";
import { UpstreamAggregator } from "./proxy/aggregator.js";
import type { ToolDef } from "./registry.js";
import type { PlatformDb } from "./platform/db.js";
import { rowToConfig } from "./platform/api.js";
import { allSkillNames, loadSkills, type Skill } from "./platform/skills.js";
import { checkRateLimit, recordRateLimit, rateLimitInfo } from "./ratelimit.js";
import { newCorrelationId, startAudit, auditEnabled } from "./audit.js";
import { startHealthChecker, stopHealthChecker, healthCheckerInfo } from "./healthcheck.js";

import { timeDefs } from "./builtins/time.js";
import { uuidDefs } from "./builtins/uuid.js";
import { fetchDefs } from "./builtins/fetch.js";
import { memoryDefs } from "./builtins/memory.js";
import { filesystemDefs, filesystemRoots } from "./builtins/filesystem.js";
import { knowledgeDefs, knowledgeEnabled } from "./builtins/knowledge.js";
import { githubDefs, githubEnabled } from "./builtins/github.js";
import { jiraDefs, jiraEnabled } from "./builtins/jira.js";
import { searchDefs, searchEnabled } from "./builtins/search.js";
import { postgresDefs, postgresEnabled } from "./builtins/postgres.js";
import { sqliteDefs, sqliteEnabled } from "./builtins/sqlite.js";
import { notionDefs, notionEnabled } from "./builtins/notion.js";
import { slackDefs, slackEnabled } from "./builtins/slack.js";
import { cryptoDefs } from "./builtins/crypto.js";
import { hnDefs } from "./builtins/hn.js";
import { weatherDefs } from "./builtins/weather.js";

const VERSION = "0.2.0";

/** Cache hint for tool catalogs: they only change on reload, so allow caching. */
const TOOL_LIST_CACHE_HINT: CacheHint = { ttlMs: 60_000, cacheScope: "public" };
const DISCOVER_CACHE_HINT: CacheHint = { ttlMs: 60_000, cacheScope: "public" };

export interface WorkstationOptions {
  /** Present when platform mode (multi-user auth) is on. */
  platform?: {
    db: PlatformDb;
    secret: string;
    platformOn: boolean;
  };
}

export interface Workstation {
  /** Web-standard stateless handler for the 2026-07-28 protocol. */
  handler: McpHttpHandler;
  /** Build a fresh McpServer from the current tool registry (stdio mode). */
  buildServer: () => McpServer;
  /** Build an McpServer for a specific user (their servers + their prefs). */
  buildServerForUser: (userId: string | undefined) => Promise<McpServer>;
  config: WorkstationConfig;
  init: () => Promise<void>;
  reload: () => Promise<string>;
  statusSummary: () => unknown;
  shutdown: () => Promise<void>;
  /** Drop cached per-user upstream connections (called when a user's servers change). */
  invalidateUser: (userId: string) => void;
  /** The skills hub catalog shipped with the workstation. */
  skills: Skill[];
}

export function createWorkstation(options: WorkstationOptions = {}): Workstation {
  let config = loadConfig();
  const registry = new ToolRegistry();
  const moduleInfo: ModuleInfo[] = [];
  const aggregator = new UpstreamAggregator();

  /** Per-user aggregators for user-registered servers, keyed by user id. */
  const userAggregators = new Map<string, UpstreamAggregator>();

  interface BuiltinModule {
    name: string;
    category: string;
    defs: ToolDef[];
    enabled: boolean;
    reason?: string;
    /** Modules whose tools depend on per-user state (e.g. the skills hub). */
    defsFactory?: (enabledSkills: Set<string>) => ToolDef[];
  }

  const builtinModules: BuiltinModule[] = [];

  /** Skills shipped with the workstation — read once at startup. */
  const skillCatalog: Skill[] = loadSkills();

  function defineModule(
    name: string,
    category: string,
    defs: ToolDef[],
    enabled: boolean,
    reason?: string,
  ): void {
    builtinModules.push({ name, category, defs, enabled, reason });
  }

  function registerBuiltins(): void {
    defineModule("time", "Utilities", timeDefs, true);
    defineModule("uuid", "Utilities", uuidDefs, true);
    defineModule("fetch", "Web & API", fetchDefs, true);
    defineModule("memory", "Knowledge & Memory", memoryDefs, true);
    defineModule("filesystem", "Files & Data", filesystemDefs, true);
    defineModule("knowledge", "Knowledge & Memory", knowledgeDefs, knowledgeEnabled.enabled);
    defineModule("github", "Development", githubDefs, githubEnabled.enabled, githubEnabled.enabled ? undefined : githubEnabled.reason);
    defineModule("jira", "Productivity", jiraDefs, jiraEnabled.enabled, jiraEnabled.enabled ? undefined : jiraEnabled.reason);
    defineModule("search", "Web & API", searchDefs, searchEnabled.enabled, searchEnabled.enabled ? undefined : searchEnabled.reason);
    defineModule("postgres", "Files & Data", postgresDefs, postgresEnabled.enabled, postgresEnabled.enabled ? undefined : postgresEnabled.reason);
    defineModule("sqlite", "Files & Data", sqliteDefs, sqliteEnabled.enabled, sqliteEnabled.enabled ? undefined : sqliteEnabled.reason);
    defineModule("notion", "Productivity", notionDefs, notionEnabled.enabled, notionEnabled.enabled ? undefined : notionEnabled.reason);
    defineModule("slack", "Communication", slackDefs, slackEnabled.enabled, slackEnabled.enabled ? undefined : slackEnabled.reason);
    defineModule("crypto", "Finance & Crypto", cryptoDefs, true);
    defineModule("hn", "Web & News", hnDefs, true);
    defineModule("weather", "Utilities", weatherDefs, true);
    // Skills hub — tools are generated per user from their enabled skills.
    builtinModules.push({
      name: "skills",
      category: "Skills Hub",
      defs: [],
      enabled: true,
      defsFactory: (enabledSkills) => skillsDefs(enabledSkills),
    });
  }

  /** Tools exposing the skills hub over MCP (per-user enabled set). */
  function skillsDefs(enabledSkills: Set<string>): ToolDef[] {
    const enabled = skillCatalog.filter((s) => enabledSkills.has(s.name));
    return [
      {
        name: "skills_list",
        description:
          "List the skills available in the workstation Skills Hub (your enabled skills). Each skill is a reusable instruction set an agent can follow. Returns name, description, category and version for each.",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Optional filter — only return skills in this category (e.g. Development, Security)",
            },
          },
        },
        handler: async (args) =>
          jsonResult({
            skills: enabled
              .filter((s) => (args.category ? s.category === String(args.category) : true))
              .map((s) => ({ name: s.name, description: s.description, category: s.category, version: s.version })),
          }),
      },
      {
        name: "skills_get",
        description:
          "Retrieve the full content of a skill from the Skills Hub — the complete instructions to follow. Use after skills_list to load a skill you want to apply.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Skill name (from skills_list)" } },
          required: ["name"],
        },
        handler: async (args) => {
          const name = String(args.name ?? "");
          const skill = enabled.find((s) => s.name === name);
          if (!skill) {
            throw new Error(`Skill "${name}" not found or not enabled for you`);
          }
          return jsonResult({
            name: skill.name,
            description: skill.description,
            category: skill.category,
            version: skill.version,
            content: skill.content,
          });
        },
      },
    ];
  }

  /** Register the always-on ops tools; `statusFn` snapshots THIS build's state. */
  function registerMeta(statusFn: () => unknown): void {
    registerModule(registry, moduleInfo, "workstation", {
      name: "workstation",
      category: "Operations",
      enabled: true,
      defs: [
        {
          name: "workstation_status",
          description:
            "Report which built-in modules and upstream MCP servers are active, why some are disabled, and total tool count.",
          inputSchema: { type: "object", properties: {} },
          handler: () => jsonResult(statusFn()),
        },
        {
          name: "workstation_reload",
          description:
            "Re-read config/servers.json, reconnect all shared upstream MCP servers, and refresh the tool list.",
          inputSchema: { type: "object", properties: {} },
          handler: async () => {
            const summary = await reload();
            return jsonResult({ message: "Reloaded", ...JSON.parse(summary) });
          },
        },
      ],
    });
  }

  /** Register one module's tools into the registry, or record why it was skipped. */
  function pushModule(
    mod: BuiltinModule,
    disabledModules: Set<string>,
    disabledTools: Set<string>,
    enabledSkills: Set<string>,
  ): void {
    const allDefs = mod.defsFactory ? mod.defsFactory(enabledSkills) : mod.defs;
    const isEnabled = mod.enabled && !disabledModules.has(mod.name);
    if (!isEnabled) {
      moduleInfo.push({
        name: mod.name,
        category: mod.category,
        enabled: false,
        reason: mod.reason ?? "disabled",
        toolCount: 0,
        tools: allDefs.map((d) => d.name),
      });
      return;
    }
    const defs = allDefs.filter((d) => !disabledTools.has(d.name));
    for (const def of defs) registry.register(def);
    moduleInfo.push({
      name: mod.name,
      category: mod.category,
      enabled: true,
      toolCount: defs.length,
      tools: defs.map((d) => d.name),
    });
  }

  /** Register upstream tools (shared or per-user aggregator) into the registry. */
  function pushUpstreams(agg: UpstreamAggregator, disabledTools: Set<string>): void {
    for (const tool of agg.allTools()) {
      if (disabledTools.has(tool.name)) continue;
      registry.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: (args) => agg.call(tool.name, args),
      });
    }
  }

  /** Rebuild the whole tool map from modules + currently connected upstreams. */
  function rebuild(
    disabledModules = new Set<string>(),
    disabledTools = new Set<string>(),
    enabledSkills: Set<string> = allSkillNames(skillCatalog),
    userAgg?: UpstreamAggregator,
  ): void {
    registry.clear();
    moduleInfo.length = 0;
    for (const mod of builtinModules) pushModule(mod, disabledModules, disabledTools, enabledSkills);
    pushUpstreams(aggregator, disabledTools);
    if (userAgg) pushUpstreams(userAgg, disabledTools);
    // Snapshot this build's summary so workstation_status is per-request accurate.
    const snapshot = statusSummary(disabledModules, disabledTools, enabledSkills, userAgg);
    registerMeta(() => snapshot);
  }

  function statusSummary(
    disabledModules = new Set<string>(),
    disabledTools = new Set<string>(),
    enabledSkills: Set<string> = allSkillNames(skillCatalog),
    userAgg?: UpstreamAggregator,
  ): unknown {
    return {
      version: VERSION,
      protocol: "2026-07-28 (stateless)",
      node: process.version,
      modules: moduleInfo,
      upstreams: aggregator.summaries(),
      userUpstreams: userAgg ? userAgg.summaries() : [],
      totalTools: registry.entries().length,
      filesystemRoots,
      disabledModules: [...disabledModules],
      disabledTools: [...disabledTools],
      enabledSkills: [...enabledSkills],
      rateLimit: rateLimitInfo(),
      audit: { enabled: auditEnabled() },
      healthcheck: healthCheckerInfo(),
    };
  }

  async function init(): Promise<void> {
    registerBuiltins();
    await aggregator.connectAll(config.upstreamServers);
    rebuild();
    // Start health checker for upstream servers.
    startHealthChecker({
      reconnect: async (key) => {
        const cfg = config.upstreamServers.find((s) => s.key === key);
        if (cfg) await aggregator.reconnect(key, cfg);
      },
      getServerState: (key) => aggregator.getState(key),
      getConfigs: () => config.upstreamServers,
    });
  }

  async function reload(): Promise<string> {
    config = loadConfig();
    await aggregator.connectAll(config.upstreamServers);
    rebuild();
    return JSON.stringify(
      { upstreams: aggregator.summaries(), modules: moduleInfo, totalTools: registry.entries().length },
      null,
      2,
    );
  }

  async function shutdown(): Promise<void> {
    stopHealthChecker();
    // Graceful drain: disconnect shared aggregators first, then user aggregators.
    await aggregator.disconnectAll();
    await Promise.allSettled([...userAggregators.values()].map((a) => a.disconnectAll()));
    userAggregators.clear();
  }

  function invalidateUser(userId: string): void {
    const agg = userAggregators.get(userId);
    if (agg) {
      void agg.disconnectAll();
      userAggregators.delete(userId);
    }
  }

  /** Get (or lazily connect) the user's private upstream aggregator. */
  async function userAggregator(userId: string): Promise<UpstreamAggregator | undefined> {
    const platform = options.platform;
    if (!platform || !userId) return undefined;
    const cached = userAggregators.get(userId);
    if (cached) return cached;

    const rows = platform.db.listServers(userId).filter((r) => r.enabled === 1);
    if (rows.length === 0) return undefined;
    const configs: UpstreamServerConfig[] = rows.map((r) => rowToConfig(r, platform.secret));
    const agg = new UpstreamAggregator();
    userAggregators.set(userId, agg);
    await agg.connectAll(configs);
    return agg;
  }

  /** Disabled builtin modules / tools and enabled skills for a user. */
  function prefsFor(userId: string | undefined): { modules: Set<string>; tools: Set<string>; skills: Set<string> } {
    const platform = options.platform;
    if (!platform || !userId) return { modules: new Set(), tools: new Set(), skills: allSkillNames(skillCatalog) };
    const hasPrefs = platform.db.getPrefs(userId) !== undefined;
    const stored = platform.db.enabledSkills(userId);
    return {
      modules: platform.db.disabledModules(userId),
      tools: platform.db.disabledTools(userId),
      // "*" (the DB default) means untouched → every skill on. Explicit lists respected.
      skills: hasPrefs ? (stored.has("*") ? allSkillNames(skillCatalog) : stored) : allSkillNames(skillCatalog),
    };
  }

  /** Build a fresh McpServer for a user (or the shared catalog when no user). */
  async function buildServerForUserInternal(userId: string | undefined): Promise<McpServer> {
    const agg = await userAggregator(userId ?? "");
    const prefs = prefsFor(userId);
    rebuild(prefs.modules, prefs.tools, prefs.skills, agg);
    return createMcpInstance(userId);
  }

  function createMcpInstance(userId: string | undefined): McpServer {
    const server = new McpServer(
      { name: "mcp-workstation", version: VERSION },
      {
        capabilities: { tools: {} },
        cacheHints: {
          "tools/list": TOOL_LIST_CACHE_HINT,
          "server/discover": DISCOVER_CACHE_HINT,
        },
        instructions:
          "Aggregated MCP workstation. Tools are prefixed by module/server key " +
          "(e.g. github_*, fs_*, pg_*, crypto_*, weather_*). Run workstation_status to see " +
          "what is active, and skills_list to see the skills hub.",
      },
    );
    for (const def of registry.entries()) {
      server.registerTool(
        def.name,
        { description: def.description, inputSchema: toStandardSchema(def.inputSchema) },
        (args) => {
          const rawArgs = args as Record<string, unknown>;
          const corrId = newCorrelationId();
          const uid = userId ?? "anonymous";
          // --- Rate limit check ---
          const rl = checkRateLimit(uid, def.name);
          if (!rl.allowed) {
            const finish = startAudit(corrId, uid, def.name, rawArgs);
            finish({ ok: false, outputBytes: 0, error: `Rate limited — retry in ${rl.retryAfterMs}ms (limit: ${rl.limit})` });
            throw new Error(`Rate limited: tool "${def.name}" — retry after ${rl.retryAfterMs}ms (limit: ${rl.limit} per window)`);
          }
          // --- Audit start ---
          const finish = startAudit(corrId, uid, def.name, rawArgs);
          return Promise.resolve(def.handler(rawArgs)).then(
            (result: import("@modelcontextprotocol/server").CallToolResult) => {
              recordRateLimit(uid, def.name);
              const outBytes = JSON.stringify(result).length;
              finish({ ok: true, outputBytes: outBytes });
              return result;
            },
            (err: unknown) => {
              recordRateLimit(uid, def.name);
              finish({ ok: false, outputBytes: 0, error: err instanceof Error ? err.message : String(err) });
              throw err;
            },
          );
        },
      );
    }
    return server;
  }

  const handler = createMcpHandler(async (ctx) => {
    // Platform mode: build the catalog for the authenticated user.
    const userId =
      typeof ctx.authInfo?.extra?.userId === "string" ? (ctx.authInfo.extra.userId as string) : undefined;
    if (options.platform && !userId) {
      // Shouldn't happen — requireBearerAuth gates /mcp before the handler.
      // Fall back to the shared catalog so the request still succeeds.
      rebuild(new Set(), new Set());
      return createMcpInstance(undefined);
    }
    return buildServerForUserInternal(userId);
  }, {
    legacy: "stateless", // serve 2025-era streamable-HTTP requests too
    responseMode: "auto",
    onerror: (err) => console.error(`[mcp-workstation] handler error: ${err instanceof Error ? err.message : err}`),
  });

  return {
    handler,
    buildServer: () => {
      rebuild(new Set(), new Set());
      return createMcpInstance(undefined);
    },
    buildServerForUser: async (userId) => buildServerForUserInternal(userId),
    config,
    init,
    reload,
    statusSummary: () => statusSummary(),
    shutdown,
    invalidateUser,
    skills: skillCatalog,
  };
}

/** Convert a JSON Schema (from builtins or upstream servers) to a Standard Schema. */
function toStandardSchema(schema: Record<string, unknown>): StandardSchemaWithJSON | undefined {
  if (schema === undefined || schema === null) return undefined;
  try {
    return fromJsonSchema(schema as JsonSchemaType);
  } catch {
    return undefined;
  }
}
