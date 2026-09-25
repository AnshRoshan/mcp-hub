import fs from "node:fs";
import path from "node:path";
import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import type { CacheHint, JsonSchemaType, McpHttpHandler, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { jsonResult } from "./result.js";
import { env, num, layeredEnv, processEnv, type EnvSource } from "./utils.js";
import { loadConfig, type WorkstationConfig, type UpstreamServerConfig } from "./config.js";
import { ToolRegistry, registerModule, type ModuleInfo } from "./registry.js";
import { ToolIndex, aliasesForModule, type ToolSearchHit } from "./toolsearch.js";
import { lintDescriptions, descriptionScore } from "./descli.js";
import { UpstreamAggregator, type ProxiedResourceEntry } from "./proxy/aggregator.js";
import type { ToolDef } from "./registry.js";
import type { PlatformDb } from "./platform/db.js";
import { rowToConfig, decodeSecrets } from "./platform/serverConfig.js";
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
import { githubModule } from "./builtins/github.js";
import { jiraModule } from "./builtins/jira.js";
import { searchModule } from "./builtins/search.js";
import { postgresDefs, postgresEnabled } from "./builtins/postgres.js";
import { sqliteDefs, sqliteEnabled } from "./builtins/sqlite.js";
import { notionModule } from "./builtins/notion.js";
import { slackModule } from "./builtins/slack.js";
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
  const aggregator = new UpstreamAggregator();

  /**
   * Per-user aggregators for user-registered servers. stdio children are
   * expensive, so sessions are single-flight, idle-evicted, and LRU-capped.
   */
  const USER_SESSION_TTL_MS = Math.max(Number(env("USER_SESSION_TTL_MS") ?? ""), 0) || 15 * 60_000;
  const MAX_USER_SESSIONS = Math.max(Number(env("MAX_USER_SESSIONS") ?? ""), 0) || 50;

  interface UserAggSlot {
    /** Single-flight: concurrent first requests share one connect. */
    promise: Promise<UpstreamAggregator>;
    lastUsed: number;
  }
  const userAggregators = new Map<string, UserAggSlot>();
  let sessionReaper: ReturnType<typeof setInterval> | undefined;

  /**
   * An immutable snapshot of one catalog (shared, or a specific user's view).
   * Built purely from its inputs — never mutated in place, so concurrent
   * requests can never see each other's catalogs.
   *
   * In lite mode, `tools` holds only the Tier-0 meta-tools; everything else
   * stays callable through `hub_call` and is reachable through `hidden`/`index`.
   */
  interface Catalog {
    tools: ToolDef[];
    hidden: Map<string, ToolDef> | null;
    index: ToolIndex | null;
    /** Upstream resources (incl. MCP Apps `ui://`), URIs verbatim. */
    resources: ProxiedResourceEntry[];
    status: unknown;
  }

  interface CatalogPrefs {
    modules: Set<string>;
    tools: Set<string>;
    skills: Set<string>;
    /** Where credential-gated builtin modules read their config from. */
    env: EnvSource;
    /** Search-first exposure: only Tier-0 tools listed, rest behind hub tools. */
    lite: boolean;
  }

  /** Tools always visible in lite mode (plus the three hub meta-tools). */
  const LITE_TIER0 = new Set(["workstation_status", "workstation_reload"]);

  /** The shared catalog — what the dashboard and `workstation_status` (no user) report. */
  let shared: Catalog = { tools: [], hidden: null, index: null, resources: [], status: null };

  interface BuiltinModule {
    name: string;
    category: string;
    /**
     * Produce this module's tools + enabled state for one catalog. Most
     * modules ignore `prefs` (constant defs); credential-gated ones build
     * clients from `prefs.env`, so each user's tools carry THEIR tokens.
     */
    forPrefs: (prefs: CatalogPrefs) => { defs: ToolDef[]; enabled: boolean; reason?: string };
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
    builtinModules.push({ name, category, forPrefs: () => ({ defs, enabled, reason }) });
  }

  /** Register a module whose tools and enabled-state depend on the user's env. */
  function defineEnvModule(
    name: string,
    category: string,
    build: (env: EnvSource) => { defs: ToolDef[]; enabled: boolean; reason?: string },
  ): void {
    builtinModules.push({ name, category, forPrefs: (prefs) => build(prefs.env) });
  }

  function registerBuiltins(): void {
    defineModule("time", "Utilities", timeDefs, true);
    defineModule("uuid", "Utilities", uuidDefs, true);
    defineModule("fetch", "Web & API", fetchDefs, true);
    defineModule("memory", "Knowledge & Memory", memoryDefs, true);
    defineModule("filesystem", "Files & Data", filesystemDefs, true);
    defineModule("knowledge", "Knowledge & Memory", knowledgeDefs, knowledgeEnabled.enabled);
    defineEnvModule("github", "Development", githubModule);
    defineEnvModule("jira", "Productivity", jiraModule);
    defineEnvModule("search", "Web & API", searchModule);
    defineModule("postgres", "Files & Data", postgresDefs, postgresEnabled.enabled, postgresEnabled.enabled ? undefined : postgresEnabled.reason);
    defineModule("sqlite", "Files & Data", sqliteDefs, sqliteEnabled.enabled, sqliteEnabled.enabled ? undefined : sqliteEnabled.reason);
    defineEnvModule("notion", "Productivity", notionModule);
    defineEnvModule("slack", "Communication", slackModule);
    defineModule("crypto", "Finance & Crypto", cryptoDefs, true);
    defineModule("hn", "Web & News", hnDefs, true);
    defineModule("weather", "Utilities", weatherDefs, true);
    // Skills hub — tools are generated per user from their enabled skills.
    builtinModules.push({
      name: "skills",
      category: "Skills Hub",
      forPrefs: (prefs) => ({ defs: skillsDefs(prefs.skills), enabled: true }),
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

  /** The two Operations tools every catalog exposes, even in lite mode. */
  function metaToolDefs(getStatus: () => unknown): ToolDef[] {
    return [
      {
        name: "workstation_status",
        description:
          "Report which built-in modules and upstream MCP servers are active, why some are disabled, total tool count, and the catalog mode (lite/full).",
        inputSchema: { type: "object", properties: {} },
        handler: () => jsonResult(getStatus()),
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
    ];
  }

  /** Register one module's tools into a catalog's registry, or record why it was skipped. */
  function pushModule(
    registry: ToolRegistry,
    info: ModuleInfo[],
    mod: BuiltinModule,
    prefs: CatalogPrefs,
    aliases: Map<string, string>,
  ): void {
    const built = mod.forPrefs(prefs);
    const isEnabled = built.enabled && !prefs.modules.has(mod.name);
    if (!isEnabled) {
      info.push({
        name: mod.name,
        category: mod.category,
        enabled: false,
        reason: built.reason ?? "disabled",
        toolCount: 0,
        tools: built.defs.map((d) => d.name),
      });
      return;
    }
    const defs = built.defs.filter((d) => !prefs.tools.has(d.name));
    for (const def of defs) registry.register(def);
    for (const [name, text] of aliasesForModule(mod.name, defs)) aliases.set(name, text);
    info.push({
      name: mod.name,
      category: mod.category,
      enabled: true,
      toolCount: defs.length,
      tools: defs.map((d) => d.name),
    });
  }

  /** Register upstream tools (shared or per-user aggregator) into a catalog's registry. */
  function pushUpstreams(
    registry: ToolRegistry,
    agg: UpstreamAggregator,
    disabledTools: Set<string>,
  ): void {
    for (const tool of agg.allTools()) {
      if (disabledTools.has(tool.name)) continue;
      registry.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // Preserve MCP Apps / icon / vendor metadata end to end (verbatim).
        _meta: tool.meta,
        title: tool.title,
        handler: (args) => agg.call(tool.name, args),
      });
    }
  }

  /**
   * Assemble a complete, immutable catalog from pure inputs: the builtin
   * module list (static after startup), the caller's prefs, and the relevant
   * aggregators. No shared state is read or written.
   */
  function assembleCatalog(prefs: CatalogPrefs, userAgg?: UpstreamAggregator): Catalog {
    const registry = new ToolRegistry();
    const info: ModuleInfo[] = [];
    const aliases = new Map<string, string>();
    for (const mod of builtinModules) pushModule(registry, info, mod, prefs, aliases);
    pushUpstreams(registry, aggregator, prefs.tools);
    if (userAgg) pushUpstreams(registry, userAgg, prefs.tools);

    // Register the always-present meta tools (status + reload) BEFORE the
    // lite/hidden split, so workstation_status is reachable in both modes.
    registerModule(registry, info, "workstation", {
      name: "workstation",
      category: "Operations",
      enabled: true,
      defs: metaToolDefs(() => status),
    });

    // Snapshot status from exactly these inputs; totalTools counts every tool
    // the caller could reach (Tier-0 + hidden), not just the listed ones.
    const all = registry.entries();
    const smells = lintDescriptions(all);
    // Upstream resources pass through with VERBATIM URIs (tool _meta references
    // them, e.g. MCP Apps `ui://…`); shared servers win URI collisions.
    const resources: ProxiedResourceEntry[] = [];
    const resUris = new Set<string>();
    for (const entry of [...aggregator.allResources(), ...(userAgg ? userAgg.allResources() : [])]) {
      if (resUris.has(entry.resource.uri)) continue;
      resUris.add(entry.resource.uri);
      resources.push(entry);
    }
    const hiddenMap = new Map(all.map((d) => [d.name, d]));
    const status: unknown = {
      version: VERSION,
      protocol: "2026-07-28 (stateless)",
      node: process.version,
      catalogMode: prefs.lite ? "lite" : "full",
      modules: info,
      upstreams: aggregator.summaries(),
      userUpstreams: userAgg ? userAgg.summaries() : [],
      totalTools: all.length,
      descriptionQuality: { score: descriptionScore(all, smells), flagged: smells.slice(0, 10) },
      filesystemRoots,
      disabledModules: [...prefs.modules],
      disabledTools: [...prefs.tools],
      enabledSkills: [...prefs.skills],
      rateLimit: rateLimitInfo(),
      audit: { enabled: auditEnabled() },
      healthcheck: healthCheckerInfo(),
    };

    if (!prefs.lite) {
      return { tools: all, hidden: null, index: null, resources, status };
    }
    // Lite: only Tier-0 meta + hub tools are listed; the rest stay callable via hub.
    const index = new ToolIndex(all.filter((d) => !LITE_TIER0.has(d.name)), aliases);
    const tools = all.filter((d) => LITE_TIER0.has(d.name));
    // hidden excludes the Tier-0 already-listed tools (they're directly callable).
    for (const name of LITE_TIER0) hiddenMap.delete(name);
    return { tools, hidden: hiddenMap, index, resources, status };
  }

  /** The catalog for a platform-mode request (their prefs + their upstreams). */
  async function catalogForUser(userId: string | undefined): Promise<Catalog> {
    const agg = await userAggregator(userId ?? "");
    return assembleCatalog(prefsFor(userId), agg);
  }

  async function init(): Promise<void> {
    registerBuiltins();
    await aggregator.connectAll(config.upstreamServers);
    shared = assembleCatalog(defaultPrefs());
    // Start health checker for upstream servers.
    startHealthChecker({
      reconnect: async (key) => {
        const cfg = config.upstreamServers.find((s) => s.key === key);
        if (cfg) await aggregator.reconnect(key, cfg);
      },
      getServerState: (key) => aggregator.getState(key),
      getConfigs: () => config.upstreamServers,
    });
    // Periodically close idle per-user upstream sessions (stdio children).
    sessionReaper = setInterval(reapIdleSessions, 60_000);
    sessionReaper.unref();
  }

  async function reload(): Promise<string> {
    config = loadConfig();
    await aggregator.connectAll(config.upstreamServers);
    shared = assembleCatalog(defaultPrefs());
    return JSON.stringify(
      {
        upstreams: aggregator.summaries(),
        modules: (shared.status as { modules: ModuleInfo[] }).modules,
        totalTools: shared.tools.length,
      },
      null,
      2,
    );
  }

  async function shutdown(): Promise<void> {
    stopHealthChecker();
    if (sessionReaper) clearInterval(sessionReaper);
    // Graceful drain: disconnect shared aggregators first, then user aggregators.
    await aggregator.disconnectAll();
    await Promise.allSettled([...userAggregators.values()].map((slot) => slot.promise.then((a) => a.disconnectAll())));
    userAggregators.clear();
  }

  function invalidateUser(userId: string): void {
    const slot = userAggregators.get(userId);
    if (!slot) return;
    userAggregators.delete(userId);
    // Also covers invalidation while still connecting: close once connect lands.
    void slot.promise.then((agg) => agg.disconnectAll());
  }

  /** Close a user's session and drop stdio children. */
  function dropUserSession(userId: string): void {
    invalidateUser(userId);
  }

  /** Idle-TTL eviction + LRU cap over connected user sessions. */
  function reapIdleSessions(): void {
    const cutoff = Date.now() - USER_SESSION_TTL_MS;
    for (const [id, slot] of userAggregators) {
      if (slot.lastUsed < cutoff) dropUserSession(id);
    }
    while (userAggregators.size > MAX_USER_SESSIONS) {
      let oldestId: string | undefined;
      let oldestAt = Infinity;
      for (const [id, slot] of userAggregators) {
        if (slot.lastUsed < oldestAt) {
          oldestAt = slot.lastUsed;
          oldestId = id;
        }
      }
      if (oldestId === undefined) break;
      dropUserSession(oldestId);
    }
  }

  /** Get (or lazily connect) the user's private upstream aggregator. */
  async function userAggregator(userId: string): Promise<UpstreamAggregator | undefined> {
    const platform = options.platform;
    if (!platform || !userId) return undefined;
    const cached = userAggregators.get(userId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.promise;
    }

    const rows = platform.db.listServers(userId).filter((r) => r.enabled === 1);
    if (rows.length === 0) return undefined;
    const configs: UpstreamServerConfig[] = rows.map((r) => rowToConfig(r, platform.secret));
    const slot: UserAggSlot = {
      promise: (async () => {
        const agg = new UpstreamAggregator();
        await agg.connectAll(configs);
        return agg;
      })(),
      lastUsed: Date.now(),
    };
    userAggregators.set(userId, slot);
    return slot.promise;
  }

  /** The single-user / shared defaults: everything on, server-owned env, full catalog. */
  function defaultPrefs(): CatalogPrefs {
    return { modules: new Set(), tools: new Set(), skills: allSkillNames(skillCatalog), env: processEnv, lite: false };
  }

  /** Disabled builtin modules / tools, enabled skills, credentials, and catalog mode for a user. */
  function prefsFor(userId: string | undefined): CatalogPrefs {
    const platform = options.platform;
    if (!platform || !userId) return defaultPrefs();
    const prefsRow = platform.db.getPrefs(userId);
    const stored = platform.db.enabledSkills(userId);
    // The user's own stored tokens shadow process env for builtin modules, so
    // e.g. github_* runs as the requesting user, not the server owner.
    const secrets = decodeSecrets(platform.db.getSecretsEnc(userId), platform.secret);
    return {
      modules: platform.db.disabledModules(userId),
      tools: platform.db.disabledTools(userId),
      // "*" (the DB default) means untouched → every skill on. Explicit lists respected.
      skills: prefsRow ? (stored.has("*") ? allSkillNames(skillCatalog) : stored) : allSkillNames(skillCatalog),
      env: layeredEnv(secrets, processEnv),
      // New users default to the token-frugal lite catalog; existing rows keep their setting.
      lite: prefsRow ? prefsRow.liteCatalog === 1 : true,
    };
  }

  /** Build a fresh McpServer for a user (or the shared catalog when no user). */
  async function buildServerForUserInternal(userId: string | undefined): Promise<McpServer> {
    const catalog = await catalogForUser(userId);
    return createMcpInstance(catalog, userId);
  }

  /** Max bytes of a tool result before it is spilled to a file (0 disables). */
  const MAX_RESULT_BYTES = Math.max(Number(env("MAX_RESULT_BYTES") ?? ""), 0) || 200_000;

  /** Control-plane tools are bounded and must stay machine-parseable — never spilled. */
  const CONTROL_PLANE_TOOL = /^(workstation_|hub_)/;

  /**
   * Spill oversized results into the workspace so the agent's context stays
   * small and the full data stays reachable (fs_read / knowledge tools).
   */
  function guardResultSize(result: import("@modelcontextprotocol/server").CallToolResult, tool: string, corrId: string) {
    if (!MAX_RESULT_BYTES || CONTROL_PLANE_TOOL.test(tool)) return result;
    const text = JSON.stringify(result);
    if (text.length <= MAX_RESULT_BYTES) return result;
    try {
      const dir = path.join(config.filesystemRoots[0] ?? path.resolve(process.cwd(), "data"), "results");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${corrId}.json`);
      fs.writeFileSync(file, text);
      const preview = (result.content as { type: string; text?: string }[])
        .map((c) => (c.type === "text" ? c.text ?? "" : ""))
        .join("\n")
        .slice(0, 4_000);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Result too large (${text.length} bytes) and was saved to ${file}. ` +
              `Preview (first ${preview.length} chars):\n${preview}\n\n` +
              `Read the full file with fs_read {"path":"${file}"} or search it with knowledge tools.`,
          },
        ],
        // Machine-readable pointer so callers never have to parse the prose.
        structuredContent: { spilled: true, path: file, originalBytes: text.length },
      };
    } catch {
      return result; // spilling is best-effort; never swallow the real result on failure
    }
  }

  function createMcpInstance(catalog: Catalog, userId: string | undefined): McpServer {
    const uid = userId ?? "anonymous";

    /** The one rate-limit → audit → invoke pipeline every call goes through. */
    const runTool = (
      def: ToolDef,
      rawArgs: Record<string, unknown>,
    ): Promise<import("@modelcontextprotocol/server").CallToolResult> => {
      const corrId = newCorrelationId();
      const rl = checkRateLimit(uid, def.name);
      if (!rl.allowed) {
        const finish = startAudit(corrId, uid, def.name, rawArgs);
        finish({ ok: false, outputBytes: 0, error: `Rate limited — retry in ${rl.retryAfterMs}ms (limit: ${rl.limit})` });
        throw new Error(`Rate limited: tool "${def.name}" — retry after ${rl.retryAfterMs}ms (limit: ${rl.limit} per window)`);
      }
      const finish = startAudit(corrId, uid, def.name, rawArgs);
      return Promise.resolve(def.handler(rawArgs)).then(
        (result: import("@modelcontextprotocol/server").CallToolResult) => {
          recordRateLimit(uid, def.name);
          const guarded = guardResultSize(result, def.name, corrId);
          finish({ ok: true, outputBytes: JSON.stringify(guarded).length });
          return guarded;
        },
        (err: unknown) => {
          recordRateLimit(uid, def.name);
          finish({ ok: false, outputBytes: 0, error: err instanceof Error ? err.message : String(err) });
          throw err;
        },
      );
    };

    const lite = catalog.index !== null && catalog.hidden !== null;
    const server = new McpServer(
      { name: "mcp-workstation", version: VERSION },
      {
        capabilities: { tools: {}, ...(catalog.resources.length > 0 ? { resources: {} } : {}) },
        cacheHints: {
          // Per-user catalogs in platform mode: never let a shared cache serve
          // one user's tool list to another.
          "tools/list": options.platform ? { ttlMs: 60_000, cacheScope: "private" as const } : TOOL_LIST_CACHE_HINT,
          "server/discover": DISCOVER_CACHE_HINT,
        },
        instructions: lite
          ? "Aggregated MCP workstation (LITE catalog). Most tools are not listed to save " +
            "context: use hub_search_tools <query> to find them, hub_get_tool to inspect a " +
            "schema, and hub_call to invoke. workstation_status lists active modules. " +
            "Skills live in skills_list/skills_get."
          : "Aggregated MCP workstation. Tools are prefixed by module/server key " +
            "(e.g. github_*, fs_*, pg_*, crypto_*, weather_*). Run workstation_status to see " +
            "what is active, and skills_list to see the skills hub.",
      },
    );

    for (const def of catalog.tools) {
      server.registerTool(
        def.name,
        {
          description: def.description,
          title: def.title,
          inputSchema: toStandardSchema(def.inputSchema),
          ...(def._meta ? { _meta: def._meta } : {}),
        },
        (args) => runTool(def, args as Record<string, unknown>),
      );
    }

    if (lite) {
      const { index, hidden } = catalog as { index: ToolIndex; hidden: Map<string, ToolDef> };
      server.registerTool(
        "hub_search_tools",
        {
          description:
            "Search the FULL workstation catalog by intent (e.g. \"create github issue\", \"weather\", " +
            "\"read a file\"). Returns matching tool names with descriptions. Use hub_get_tool for a " +
            "schema, then hub_call to run one. This is how you reach tools not shown in the list.",
          inputSchema: toStandardSchema({
            type: "object",
            properties: {
              query: { type: "string", description: "What you want to do, in natural words" },
              limit: { type: "integer", minimum: 1, maximum: 25, description: "Max results (default 8)" },
            },
            required: ["query"],
          }),
        },
        (args) => {
          const hits = index.search(String((args as Record<string, unknown>).query ?? ""), num((args as Record<string, unknown>).limit, 8));
          return jsonResult({
            query: (args as Record<string, unknown>).query,
            results: hits.map((h: ToolSearchHit) => ({
              name: h.name,
              description: hidden.get(h.name)?.description ?? "",
              score: Math.round(h.score * 1000) / 1000,
            })),
          });
        },
      );
      server.registerTool(
        "hub_get_tool",
        {
          description: "Get the full input schema of one catalog tool (from hub_search_tools) before calling it via hub_call.",
          inputSchema: toStandardSchema({
            type: "object",
            properties: { tool: { type: "string", description: "Exact tool name" } },
            required: ["tool"],
          }),
        },
        (args) => {
          const name = String((args as Record<string, unknown>).tool ?? "");
          const def = hidden.get(name);
          if (!def) throw new Error(`Tool "${name}" not in catalog. Run hub_search_tools to find it.`);
          return jsonResult({
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema,
            ...(def.title ? { title: def.title } : {}),
            ...(def._meta ? { _meta: def._meta } : {}),
          });
        },
      );
      server.registerTool(
        "hub_call",
        {
          description:
            "Invoke any catalog tool by name with its arguments object (same shape as calling it " +
            "directly). Rate limits and auditing apply identically.",
          inputSchema: toStandardSchema({
            type: "object",
            properties: {
              tool: { type: "string", description: "Exact tool name from hub_search_tools/hub_get_tool" },
              arguments: { type: "object", description: "Tool arguments matching its inputSchema" },
            },
            required: ["tool"],
          }),
        },
        (args) => {
          const a = args as Record<string, unknown>;
          const name = String(a.tool ?? "");
          const def = hidden.get(name);
          if (!def) throw new Error(`Tool "${name}" not in catalog. Run hub_search_tools first.`);
          return runTool(def, (a.arguments ?? {}) as Record<string, unknown>);
        },
      );
    }

    // Proxied upstream resources (verbatim URIs) — incl. MCP Apps `ui://` documents
    // referenced from tool `_meta`, so capable clients can resolve them through the hub.
    const usedNames = new Set<string>();
    for (const entry of catalog.resources) {
      const base = entry.resource.name || entry.resource.uri;
      let name = base;
      for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}`;
      usedNames.add(name);
      server.registerResource(
        name,
        entry.resource.uri,
        {
          title: entry.resource.title,
          description: entry.resource.description,
          mimeType: entry.resource.mimeType,
        },
        () => entry.read() as Promise<import("@modelcontextprotocol/server").ReadResourceResult>,
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
      return createMcpInstance(shared, undefined);
    }
    return buildServerForUserInternal(userId);
  }, {
    legacy: "stateless", // serve 2025-era streamable-HTTP requests too
    responseMode: "auto",
    onerror: (err) => console.error(`[mcp-workstation] handler error: ${err instanceof Error ? err.message : err}`),
  });

  return {
    handler,
    buildServer: () => createMcpInstance(shared, undefined),
    buildServerForUser: async (userId) => buildServerForUserInternal(userId),
    config,
    init,
    reload,
    statusSummary: () => shared.status,
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
