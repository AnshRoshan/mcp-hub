# MCP Hub Research — Handoff Brief

Date: 2026-09-25 · Status: OPEN QUESTIONS for research agents
This file is self-contained: a model with only this brief + web access can research it independently.

## Who is asking

The team behind **MCP Workstation** (`mcp-workstation`) — an open-source (MIT) TypeScript
Node.js ≥22 project at `src/` that is simultaneously:

1. **An MCP aggregator/gateway**: one endpoint that proxies many upstream MCP servers
   (stdio + HTTP), namespacing their tools (`serverkey_tool`), plus ~18 built-in tool
   modules (time, uuid, fetch, filesystem, memory, knowledge w/ FTS+vector search,
   github, jira, search, notion, slack, postgres, sqlite, crypto, hn, weather…).
2. **A multi-user platform**: Better Auth (Google/GitHub OAuth), per-user API tokens
   (`mcw_*` Bearer) gating `/mcp`, per-user server registries, per-user prefs
   (module/tool/skill toggles), **per-user encrypted credentials for builtins**
   (each user's own `GITHUB_TOKEN` etc., shadowing process env), skills hub
   (markdown instruction sets served over MCP).
3. **On the bleeding edge of the spec**: implements the **2026-07-28 stateless
   protocol revision** (per-request `_meta` envelope, no initialize handshake,
   no sessions) via SDK v2 (`@modelcontextprotocol/server|client|node`), with
   a legacy bridge for 2025-era Streamable HTTP and deprecated HTTP+SSE.
   React dashboard (Astryx design system) served same-origin; aggressive CORS
   policy (wildcard only on the Bearer-gated `/mcp`).

Existing efficiency/architecture features: connection pooling per user with
single-flight connect + idle-TTL + LRU eviction of stdio children, rate limiting,
structured audit logs with secret masking, upstream health checks w/ auto-reconnect,
pure per-request catalog assembly (no shared mutable state).

## The three questions

### Q1 — MCP standard, current state (as of late 2026)
- What is the latest approved MCP spec revision(s) after 2025-06-18 (e.g.
  2025-11-25 and anything in 2026)? Exact status of: stateless operation / per-request
  envelope, tasks (long-running work), elicitation, sampling, MCP Apps / UI standard,
  registry (`registry.modelcontextprotocol.io`), OAuth 2.1 authorization spec,
  entitlement/resource indicators, dynamic discovery (`list_changed`, tool
  annotations, icons). Which SEPs are ratified vs pending?
- What does a **remote** MCP server need to be "very usable remotely" in practice
  (auth: DCR vs static clients, token refresh, scoped tokens; hosting on
  Cloudflare Workers / Vercel / Fastly edge; session-free designs;
  `.well-known/oauth-protected-resource` discovery)?
- How does our 2026-07-28 stateless implementation compare to where the ecosystem
  (clients: Claude, ChatGPT, Cursor, VS Code, Goose, Zed…) actually is today?
  Which clients still require initialize/session? Where are we ahead/behind?

### Q2 — Open-source projects to integrate from or with
Survey (with stars, last-activity, license, language, transport support) and
judge fit against our hub:
- **Gateways/aggregators**: Docker MCP Gateway, mcpd (daemon, connection sharing),
  mcptools (many servers, one process, search-first exposure), ContextForge,
  IBM/mcpgateway, MCPMaster, higress mcp, smithery, glama, mcp.run,
  Superinterface, keval Hasoko?, others that matter.
- **Registries/marketplaces** we could publish to or sync: official MCP Registry,
  mcp.so, Smithery, Glama, DuckDuckGo app hub?, awesome-lists.
- **Security**: mcp-scan (Checkpoint), Invariant Labs gateway/scanners, MCP
  threat modeling (MITRE ATLAS mapping), supply-chain scanning for servers.
- **Feature sources**: FastMCP (incl. FastMCP 2.x "Prompts as tasks"?, MCP-UI,
  mcp-ui), official sampling/elicitation demos, MCP task implementations,
  hooks/observability (mcp-observability, OpenTelemetry conventions).
For each shortlisted item: **adopt (run alongside) / absorb (integrate code or
spec) / imitate (copy the pattern)** — with the concrete delta to our architecture.

### Q3 — The integration doctrine: min agent footprint, max capability, remote-first
- **Token/context efficiency at scale**: how do the best hubs expose 100–1000+
  tools without blowing agent context? Evidence on: search-first/"tool search"
  (Anthropic Tool Search Tool, OpenAI tool search, mcptools lazy mode, Smithery
  dynamic filtering), namespaces with routing meta-tools (`hub_search`,
  `hub_activate`, `hub_call`), progressive disclosure (descriptions, schema
  compaction, `$ref` sharing), caching `tools/list`, structured output cost.
  Any published numbers (tokens saved, accuracy effects)?
- **Memory/CPU/space at the edge**: cost of stdio children vs pooled HTTP
  connections; single-process bundling vs separate server; WAL vs network DB for
  multi-tenant; on-demand spawn latency numbers; warm-pool vs cold-start.
- **Remote-MCP-first API design**: what must our hub expose so ANY agent (hosted
  ChatGPT/Claude projects, Cursor, CLI agents) connects via one remote URL and
  gets full features with minimal negotiation? Per-user remote endpoints
  (path vs token scoping), OAuth flows for third-party clients, `tools/list`
  caching hints, rate-limit headers, JSON-RPC batching, streaming large results.
- **Anti-patterns** the research should call out (e.g. one-server-per-tab bloat,
  200+ static tools in context, session-heavy designs that die on serverless).

## Deliverable expected back

Decision report: chosen direction per question, every rejected option with
concrete reasons, verified numbers (not remembered), a "what are we trading
away" table, and a ranked 4-sprint integration ladder for our codebase.
