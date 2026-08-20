# 🖥️ MCP Workstation

**One MCP endpoint. Every MCP server. Your own multi-user platform.**

MCP Workstation is a single MCP server that acts as an **aggregator**: your AI client
connects to it **once** and gets every tool from every MCP server you've registered —
plus a dense set of built-in tools — behind one connection.

Run it in **platform mode** (set `BETTER_AUTH_SECRET`) and it becomes a full product:

- **Sign-in with Google or GitHub** (Better Auth) at a built-in dashboard (`/`)
- **Per-user MCP servers** — each user registers their own stdio/HTTP MCP servers,
  with secrets stored **encrypted** (AES-256-GCM), and toggles them on/off
- **API tokens** per user; every `/mcp` request must carry `Authorization: Bearer <token>`
- **Per-user catalogs** — tool lists are built per request from *that user's* enabled
  servers and module prefs. Users only ever see their own servers.
- **Categorized modules & tools** — everything ships on by default, grouped by category
  (Development, Data, Finance & Crypto, …), with **per-tool toggles**: turn off a whole
  module *or* a single tool (e.g. keep `crypto_price` but hide `crypto_trending`).
- **A Skills Hub** — reusable agent instruction sets (debugging, code review, security
  audits, …) shipped alongside the MCP tools, browsable in the dashboard and loadable by
  any connected client via `skills_list` / `skills_get`. One hub, MCP + skills together.

It speaks the **2026-07-28 MCP specification** (the newest release): a **stateless
protocol core**. There is no `initialize` handshake, no `Mcp-Session-Id`, no connection
state — every request is self-contained and independently authenticated, so the server
scales behind a plain round-robin load balancer. Tools are namespaced
(`github_create_issue`, `mybox_read_file`, …) so nothing collides and routing is automatic.

```
┌──────────────┐   Bearer token + stateless request   ┌─────────────────────────────────┐
│  Claude /    │ ───────────────────────────────────▶ │         MCP Workstation        │
│  Cursor /    │  http://localhost:3125/mcp           │  ┌───────────────────────────┐  │
│  VS Code     │ ◀─────────────────────────────────── │  │ Built-in modules (shared) │  │
└──────────────┘                                     │  │  time uuid memory github… │  │
┌──────────────┐                                     │  └───────────────────────────┘  │
│  Browser     │  /  (dashboard)                     │  ┌───────────────────────────┐  │
│  Google /    │ ──────────────────────────────────▶ │  │ Per-user proxy engine    │  │
│  GitHub      │  /api/auth/*, /api/*                │  │  ▶ user's stdio servers   │  │
└──────────────┘                                     │  │  ▶ user's HTTP servers    │  │
                                                     │  └───────────────────────────┘  │
                                                     └─────────────────────────────────┘
```

## Quick start

Requires **Node.js ≥ 22.5** (for the built-in `node:sqlite`).

**1. Run with platform mode (recommended):**

```bash
npm install
npm run build
cp .env.example .env        # then set BETTER_AUTH_SECRET + OAuth keys (see below)
npm start
```

**2. Or run single-user, no auth (everything is open):**

```bash
npm start                   # platform mode stays off without BETTER_AUTH_SECRET
```

You'll see a startup report listing active modules, connected upstream servers, and
whether platform mode is on:

```
[mcp-workstation]   ✔ time: 2 tools
[mcp-workstation]   ✖ github: GITHUB_TOKEN not set
[mcp-workstation] 22 tools available
[mcp-workstation] platform mode: ON (multi-user auth)
[mcp-workstation] dashboard: http://localhost:3125/
```

## Platform mode — turning it on

Add to `.env`:

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32)   # REQUIRED — turns platform mode on

# Google OAuth (redirect URI: {BETTER_AUTH_URL}/api/auth/callback/google)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# GitHub OAuth (callback URL: {BETTER_AUTH_URL}/api/auth/callback/github)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Then open **http://localhost:3125/** and sign in with Google or GitHub. Email/password
sign-in is on by default for development (`ALLOW_EMAIL_AUTH=false` to disable).

From the dashboard you can:

- **Add MCP servers** — pick `stdio` (a local command) or `http` (a remote endpoint),
  name it (tools appear as `name_*`), and set env vars / headers. Secrets are encrypted
  at rest and never returned by the API.
- **Toggle servers on/off** — disabled servers stop appearing in your endpoint instantly.
- **Mint API tokens** — name a token (e.g. "Claude Code"), copy it once, revoke anytime.
- **Toggle modules & individual tools** — everything is on by default; drill into any
  module and switch off single tools, or hide whole categories you don't use.
- **Browse the Skills Hub** — enable/disable skills, read their full instructions, and
  let your clients pull them over MCP.

## Connect your AI client

First create an **API token** in the dashboard. Then point your client at the endpoint
with the token as a Bearer header:

| Client | Configuration |
|---|---|
| **Claude Code** | `claude mcp add --transport http workstation http://localhost:3125/mcp` + set the `Authorization: Bearer <token>` header on the connection |
| **Cursor** | Settings → MCP → Add new MCP server → Type: `http`, URL: `http://localhost:3125/mcp`, Headers: `{ "Authorization": "Bearer <token>" }` |
| **VS Code / Copilot** | `.vscode/mcp.json` → `"type": "http"`, URL + `Authorization` header |

The endpoint serves the **2026-07-28 stateless protocol**, falls back to serving
**2025-era streamable-HTTP** requests automatically, and still bridges the deprecated
**legacy HTTP+SSE** transport for older clients (in platform mode its message POSTs are
authenticated too). Requests without a valid token get a proper `401` + `WWW-Authenticate`
challenge.

Local apps can also use stdio (single-user mode):

```bash
npm run stdio
```

## What's new — 2026-07-28 features wired in

- **Stateless core** — no handshake, no sessions. Each request carries its protocol
  version, client identity, and capabilities in a `_meta` envelope. The old
  session-recovery/session-reaping code is gone entirely; the server is just a handler.
- **`server/discover`** — clients can probe capabilities up front (optional).
- **Cacheable list results** — `tools/list` and `server/discover` return
  `ttlMs` + `cacheScope` hints (tool catalogs only change on reload).
- **Header-based routing** — requests carry `Mcp-Method` / `Mcp-Name` headers, so
  gateways, rate limiters, and WAFs can route and meter without parsing JSON bodies
  (missing headers are rejected with a spec-compliant error).
- **`resultType: "complete"`** results with `io.modelcontextprotocol/serverInfo` in `_meta`.
- Built on **SDK v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/client`),
  web-standards based, with the client auto-negotiating protocol era against upstreams.

## Built-in tools (no API keys needed for the core set)

| Module | Tools | Enabled by |
|---|---|---|
| `time` | `get_current_time`, `convert_timezone` | always |
| `uuid` | `uuid_generate` | always |
| `fetch` | `fetch_url` (timeout, size cap, domain allowlist) | always |
| `memory` | `memory_set/get/delete/list/search/clear` — persistent key-value store | always |
| `filesystem` | `fs_read/write/list/mkdir/remove/stat/search` — **sandboxed** to `FILESYSTEM_ROOTS` | always |
| `sqlite` | `sqlite_list_tables/query/execute` — via `node:sqlite` | always |
| `knowledge` | `knowledge_index/search/fts_search/vector_search/index_workspace/status/clear` — **full-text (FTS5/BM25) + semantic vector search**, zero config | always |
| `github` | 27 tools — `gh_get_user/get_repo/create_repo/list_repos/search_repos`, issues (`list/get/create/update/comment/search`), PRs (`list/get/create/merge/review`), files (`get/write/delete`), `list_commits/branches/releases/create_release`, Actions (`trigger_workflow/list_workflow_runs`), `rate_limit` | `GITHUB_TOKEN` |
| `jira` | 15 tools — `jira_search_issues` (JQL), `get/create/update_issue`, `list_transitions/transition_issue`, `add_comment/get_comments`, `add_worklog`, `list_projects/get_project`, `list_boards/list_sprints`, `list_issue_types/list_assignable_users` | `JIRA_BASE_URL` + `JIRA_API_TOKEN` (+`JIRA_EMAIL`) |
| `search` | `web_search`, `web_extract` (Brave / Tavily / Exa) | any of `BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY` |
| `crypto` | `crypto_price`, `crypto_market`, `crypto_trending`, `crypto_search`, `crypto_convert` — live prices, market data and conversions (CoinGecko) | always |
| `hn` | `hn_top/new/ask/show`, `hn_item`, `hn_search` — Hacker News stories, threads and full-text search | always |
| `weather` | `weather_current`, `weather_forecast`, `weather_geocode` — conditions & forecasts (Open-Meteo) | always |
| `skills` | `skills_list`, `skills_get` — pull your enabled skills' instructions over MCP | always |

> GitHub and Jira both support **enterprise/self-hosted instances** via `GITHUB_API_URL`
> and `JIRA_BASE_URL`. Jira accepts an API token (Basic auth with `JIRA_EMAIL`) or a PAT.
| `postgres` | `pg_list_tables/describe_table/query` | `DATABASE_URL` |
| `notion` | `notion_search/get_page/list_block_children/create_page/append_blocks` | `NOTION_TOKEN` |
| `slack` | `slack_post_message/list_channels/channel_history/list_users` | `SLACK_BOT_TOKEN` |
| `workstation` | `workstation_status`, `workstation_reload` | always |

Copy `.env.example` to `.env`, fill in the keys you have, and restart. Missing keys simply
disable that module — everything else keeps working.

### 🧠 Knowledge base — full-text + vector search (zero config)

The `knowledge` module gives your AI a searchable memory, out of the box:

- **Full-text search** — SQLite FTS5 with BM25 ranking (`knowledge_fts_search`)
- **Semantic vector search** — local embeddings (`all-MiniLM-L6-v2`, 384-dim),
  downloaded once and cached; runs fully offline afterwards (`knowledge_vector_search`)
- **Hybrid search** — FTS + vector merged and ranked (`knowledge_search`)
- **Auto-fallback** — if the embedding model can't load, a TF-IDF vectorizer takes
  over, so search always works
- **Workspace indexing** — `knowledge_index_workspace` crawls the sandboxed
  filesystem roots and indexes text/code files in chunks

```bash
# add documents, then search
knowledge_index        { "text": "...", "title": "...", "source": "..." }
knowledge_search       { "query": "feline companions that purr" }   # semantic
knowledge_fts_search   { "query": "javascript server" }              # exact/BM25
```

The embedding model downloads on first vector-search use (one-time, ~23 MB),
stored in the local HuggingFace cache. No API keys required.

### 💡 Skills Hub — instructions your agents can follow

The workstation ships a library of **skills**: markdown playbooks for recurring work
(`debugging`, `code-review`, `git-workflow`, `sql-querying`, `web-research`,
`documentation`, `deployment-checklist`, `security-audit` — each with a description,
category and version). They sit **next to** the MCP tools in one hub:

- Everything is **on by default** — no setup.
- The dashboard has a dedicated **Skills** page: browse by category, read any skill's
  full instructions in a preview, and toggle skills on/off per user.
- Connected clients pull them over MCP: `skills_list` (names, descriptions, categories)
  then `skills_get { "name": "debugging" }` for the full content.
- Skills live in `skills/*.md` — add one with the same frontmatter (name, description,
  category, version) and rebuild.

## Adding your own MCP servers (the aggregator part)

Copy `config/servers.example.json` to `config/servers.json` and list the servers you want
aggregated. The workstation connects to each at startup (via the v2 client, which
auto-negotiates with both modern **and** legacy upstream servers) and merges their tools
into its own list, prefixed with the server's `key`.

```jsonc
{
  "servers": [
    {
      "key": "myfiles",                       // → tools appear as myfiles_*
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/path/to/folder"],
      "env": { "SOME_TOKEN": "..." }          // optional extra env for the child process
    },
    {
      "key": "remote",
      "type": "http",                         // remote Streamable HTTP / SSE servers
      "url": "https://your-mcp-server.example.com/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  ]
}
```

- `enabled: false` (or a bad entry) skips the server; a server that fails to start is
  reported in `workstation_status` instead of crashing the workstation.
- After editing `servers.json`, call the `workstation_reload` tool — because every HTTP
  request builds a fresh tool catalog from the live registry, the new tools appear on the
  very next `tools/list`.

## Operations

- **`workstation_status`** — which modules are active (and why others aren't), which
  upstream servers are connected, total tool count, protocol version.
- **`workstation_reload`** — re-reads `servers.json`, reconnects upstreams, refreshes the
  tool list.
- Endpoint path and port are configurable: `MCP_PATH` (default `/mcp`), `PORT` (default `3125`).

## Security notes

- **Every `/mcp` request is authenticated in platform mode.** No token, no tools. Tokens
  are stored as SHA-256 hashes, never plaintext; per-user server secrets (env vars,
  headers) are encrypted with AES-256-GCM using `BETTER_AUTH_SECRET` and never returned
  by the API.
- **Multi-tenant isolation.** Each request builds the tool catalog from *that user's*
  enabled servers and prefs — a user can never see or call another user's servers.
- **Filesystem is sandboxed.** `fs_*` tools refuse paths outside `FILESYSTEM_ROOTS`
  (default `./data/workspace`).
- **Databases are read-only by default.** `pg_query` and `sqlite_query` block write
  statements unless you explicitly set `PG_ALLOW_WRITE=true` / `SQLITE_ALLOW_WRITE=true`.
- `fetch_url` can be restricted to specific domains with `allowed_domains`.
- Every key-gated module is **off unless you set the key**. Nothing phones home.
- In single-user mode (no `BETTER_AUTH_SECRET`) there is **no auth** — bind to localhost
  or put a reverse proxy in front. Sessions use `secure` cookies automatically when the
  public URL is HTTPS.

## Development

```bash
npm run typecheck         # fast type check (backend)
npm run typecheck:web     # type check (React dashboard)
npm test                  # builds + runs the core end-to-end smoke test
npm run test:platform     # platform mode: signup → tokens → per-user /mcp → isolation
npm run test:integrations # GitHub + Jira modules against a local mock API (no real credentials)
npm run dev               # run the backend from source (serves the built dashboard at /)
npm run dev:web           # Vite dev server for the dashboard (proxies /api + /mcp to the backend)
npm run build:web         # rebuild the dashboard into public/ (served by the backend)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) (how to add a module) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the pieces fit together).

## Project layout

```
src/
  index.ts            entry point: boots workstation + platform (auth, DB, dashboard)
  server.ts           per-request McpServer built for the authenticated user,
                      shared registry + per-user upstream aggregators
  http.ts             node:http front-end: /api/auth/*, /api/*, static UI, /mcp
                      (Bearer-gated in platform mode, legacy SSE bridge kept)
  config.ts           .env + config/servers.json loading
  registry.ts         mutable tool registry + module registration
  platform/
    auth.ts           Better Auth instance (Google + GitHub, cookies)
    db.ts             SQLite: auth tables (auto-migrated) + servers/tokens/prefs
    tokens.ts         API-token mint/verify + the /mcp Bearer verifier
    api.ts            dashboard REST API (servers CRUD, tokens, prefs, skills)
    skills.ts         loads skills/*.md (frontmatter) into the skills hub
    crypto.ts         AES-256-GCM secret encryption + SHA-256 token hashing
  proxy/
    upstream.ts       v2 client connection to one stdio/HTTP MCP server, namespacing
    aggregator.ts     connect-all / list-all / route-calls across upstreams
  builtins/           time, uuid, fetch, memory, filesystem, knowledge, github,
                      jira, search, postgres, sqlite, notion, slack, crypto, hn,
                      weather (+ the skills module)
skills/               *.md — the skills hub library (one markdown file per skill)
public/
  index.html          built React dashboard (emitted by `npm run build:web`)
  assets/             hashed JS/CSS bundles (React + Astryx + Tailwind)
web/                  the dashboard source — React 19 + Vite + Tailwind CSS v4
                      (layout utilities only), Meta's Astryx design system
                      (@astryxdesign/core + theme-neutral, forced dark),
                      lucide-react (icons)
  src/
    App.tsx           root: session gate + view router + toast viewport
    main.tsx          Astryx Theme provider (neutral theme, dark mode)
    lib/api.ts        REST client + types
    lib/store.tsx     app state: session, data, routing, toasts
    lib/catalog.ts    MCP Directory catalog + connect-guide client configs
    components/       Shell (AppShell + TopNav + SideNav), ui primitives
    views/            Auth, Dashboard, Directory, Connect, Servers, Tokens,
                      Modules, Skills, Settings
scripts/
  smoke.mjs           core end-to-end test (npm test)
  smoke-platform.mjs  platform-mode end-to-end test (npm run test:platform)
  smoke-ghjira.mjs    GitHub + Jira mock-API test
  test-upstream.mjs   tiny stdio MCP server used by the platform test
docs/
  ARCHITECTURE.md     how the pieces fit together
```

## Roadmap ideas

- MRTR (Multi Round-Trip Requests) — tools that ask the user to confirm mid-call
  (e.g. before creating a GitHub issue), via `input_required` results
- Per-user keys for built-in modules (currently server-level env keys are shared)
- Tasks extension for long-running agent work
- Resource + prompt aggregation from upstreams (currently tools only)
