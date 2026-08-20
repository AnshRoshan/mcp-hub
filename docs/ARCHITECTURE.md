# Architecture

MCP Workstation is a **stateless MCP aggregator platform**: one endpoint that speaks
the 2026-07-28 MCP protocol and exposes tools from built-in modules *and* from other
MCP servers, namespaced so nothing collides — with optional **multi-user auth**
(Google/GitHub sign-in, per-user servers, API tokens) on top.

```
                    ┌────────────────────────────────────────────────────────┐
   MCP client ─────▶│  node:http                                            │
   (with Bearer     │   /api/auth/*  → Better Auth (Google/GitHub, cookies)  │
    token)          │   /api/*       → dashboard REST (servers, tokens, prefs)│
                    │   /            → static dashboard UI (public/)          │
                    │   /mcp         → requireBearerAuth → createMcpHandler   │
                    │        │         (legacy SSE bridge for old clients)    │
                    │        ▼                                               │
                    │  per-request McpServer (built for THE USER from         │
                    │   shared builtins + their enabled servers + prefs)      │
                    │        │                                               │
                    │        ▼                                               │
                    │  ToolRegistry  ◀── builtins/*                           │
                    │        │      ◀── shared UpstreamAggregator             │
                    │        │      ◀── per-user UpstreamAggregator (cached)  │
                    │        ▼                                               │
                    │  stdio/HTTP MCP servers  +  PlatformDb (SQLite)         │
                    └────────────────────────────────────────────────────────┘
```

## The stateless core

The 2026-07-28 spec removed the `initialize` handshake and session state. Every
HTTP request is self-contained: it carries its protocol version, client identity,
and capabilities in a `_meta` envelope, and the server answers it directly.

That shapes this codebase:

- **No sessions, ever.** `src/http.ts` keeps no session map. `createMcpHandler`
  from the SDK serves each request with a **fresh `McpServer` instance** built by
  the factory in `src/server.ts`.
- **Fresh tool catalog per request.** The factory reads the shared
  `ToolRegistry` when it builds each server. `workstation_reload` just rebuilds
  the registry — the very next request already sees the new tools. No
  re-registration dance, no `list_changed` bookkeeping needed.
- **App-level state is explicit.** Anything that must persist (memory, knowledge
  base, files, databases) is stored in files/SQLite and surfaced through tools —
  per the spec's own recommendation ("mint an explicit handle, pass it back as
  an argument").
- **Backward compatibility for free.** The SDK's handler also serves 2025-era
  streamable-HTTP requests (`legacy: 'stateless'`), and `src/http.ts` bridges the
  deprecated HTTP+SSE transport by forwarding each message to the same stateless
  handler and writing the response back over the stream.

## Platform layer (multi-user auth)

Platform mode turns on when `BETTER_AUTH_SECRET` is set. `src/index.ts` then builds:

- **`PlatformDb`** (`src/platform/db.ts`) — one SQLite file (`data/platform.db`)
  holding both the Better Auth tables and the app tables. The auth tables are
  **derived from Better Auth's own `getSchema()`** at startup, so they stay in
  sync with the installed version — no hand-written migrations.
- **`createAuth`** (`src/platform/auth.ts`) — Better Auth bound to the same SQLite
  file via `node:sqlite` (`DatabaseSync`). Google + GitHub social providers, cookie
  sessions, optional email/password for dev.
- **Tokens** (`src/platform/tokens.ts`) — API tokens are minted as random
  `mcw_…` strings, stored as **SHA-256 hashes**, and verified per request by an
  `OAuthTokenVerifier` consumed by the SDK's `requireBearerAuth`.
- **REST API** (`src/platform/api.ts`) — session-aware CRUD: a user's servers
  (stdio/http, with env/headers **AES-256-GCM encrypted** at rest via
  `src/platform/crypto.ts`), API tokens, and module preferences.

### Per-user tool catalogs

The MCP factory in `src/server.ts` is the key piece. Each request:

1. `requireBearerAuth` validates the `Authorization` header against the token
   store, producing an `AuthInfo` whose `extra.userId` identifies the caller.
2. The factory reads `ctx.authInfo` and builds an `McpServer` from:
   - **shared built-in modules** (filtered by the user's `disabledModules` prefs),
   - **the shared upstream aggregator** (`config/servers.json` — operator-curated),
   - **a per-user upstream aggregator** — lazily connected from the user's
     enabled server rows, cached per user, torn down on server changes via
     `invalidateUser()`.

Users never see each other's servers: the catalog for a request only ever contains
that user's rows. `workstation_status` snapshots the build, so it reports the exact
catalog the caller sees.

## Tool model

A `ToolDef` is the unit of capability:

```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (args) => Promise<CallToolResult> | CallToolResult;
}
```

- Built-ins declare their `ToolDef`s directly (see `src/builtins/*`).
- Proxied tools are synthesized from upstream `tools/list` responses and wrapped
  with `namespace(key, toolName)` → e.g. `github_create_issue`.
- `registerModule` (in `src/registry.ts`) either registers a module's tools or
  records *why* it was skipped (missing API key) — surfaced by
  `workstation_status`.

The per-request `McpServer` registers every tool via
`registerTool(name, { description, inputSchema }, handler)` where the JSON Schema
is converted with `fromJsonSchema(...)`. The server advertises cache hints for
`tools/list` and `server/discover` (`ttlMs`/`cacheScope`), so clients can cache
the tool catalog.

## Proxy engine

`src/proxy/upstream.ts` + `src/proxy/aggregator.ts`:

1. **Connect** — for each entry in `config/servers.json`, create a v2 `Client`
   over `StdioClientTransport` (spawned command) or
   `StreamableHTTPClientTransport` (remote URL). The v2 client auto-negotiates
   protocol era, so both modern and legacy upstream servers work.
2. **List** — `client.listTools()` (auto-paginated); each tool is namespaced
   `<key>_<tool>` and registered as a `ToolDef` that routes back to the upstream.
3. **Route** — on `tools/call`, the handler looks up the prefixed name, finds the
   owning upstream, and calls `client.callTool({ name: originalName, ... })`,
   returning the result verbatim.
4. **Resilience** — a server that fails to start is recorded in `workstation_status`
   instead of crashing the workstation; `workstation_reload` reconnects everything.

## Storage

| Store | Where | Used by |
|---|---|---|
| JSON file | `MEMORY_FILE` (default `data/memory.json`) | `memory_*` |
| SQLite (`node:sqlite`) | `SQLITE_PATH` (default `data/workstation.db`) | `sqlite_*` |
| SQLite (FTS5 + embeddings) | `KNOWLEDGE_DB` (default `data/knowledge.db`) | `knowledge_*` |
| Filesystem (sandboxed) | `FILESYSTEM_ROOTS` (default `data/workspace`) | `fs_*` |

## Knowledge base (vector + full-text search)

`src/builtins/knowledge.ts` is the zero-config search module:

- **Full-text**: SQLite **FTS5** virtual table with **BM25** ranking
  (`knowledge_fts_search`).
- **Vector**: local embeddings via `@huggingface/transformers`
  (`all-MiniLM-L6-v2`, 384-dim) — downloaded once, cached, fully offline after
  that. Stored as `Float32Array` blobs in SQLite; search is cosine similarity
  (`knowledge_vector_search`).
- **Hybrid**: `knowledge_search` merges FTS + vector results by score.
- **Fallback**: if the embedding model can't load (e.g. first run offline), a
  deterministic TF-IDF vectorizer takes over so the module always works.
- **Workspace indexing**: `knowledge_index_workspace` crawls the sandboxed
  filesystem roots and indexes text/code files in chunks.

Everything is lazy: the embedding model is only loaded on first use, so server
startup stays instant.

## Security posture

- **Platform mode authenticates everything.** `/mcp` requests without a valid
  token get a `401` + `WWW-Authenticate` challenge. Tokens are stored hashed
  (SHA-256); per-user server secrets are encrypted (AES-256-GCM).
- **Multi-tenant isolation.** The per-user factory never registers another user's
  servers; toggling a server off drops it from the next request.
- Filesystem sandboxed to `FILESYSTEM_ROOTS`; relative paths resolve inside them.
- Databases read-only unless `*_ALLOW_WRITE=true` is set.
- Key-gated modules (github, notion, slack, search, postgres) are off unless the
  key is present — nothing phones home by default.
- `fetch_url` supports a domain allowlist.
- Without `BETTER_AUTH_SECRET` there is no auth at all — single-user mode.
  Sessions use secure cookies automatically behind HTTPS.
