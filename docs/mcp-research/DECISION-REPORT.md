# MCP Hub Research — Decision Report

Date: 2026-09-25 · Authors: research agents + main-agent cross-check
Input: [BRIEF.md](BRIEF.md) · Claims marked **V** verified directly by main agent; **S** single-source.

## TL;DR — the decisions

1. **We are on the right spec and should lean into it.** The 2026-07-28 revision is a real, ratified spec (**V**) and our stateless `_meta`-envelope implementation matches its core (no initialize/sessions, `Mcp-Method`/`Mcp-Name` headers, `ttlMs`/`cacheScope` — all confirmed on the official changelog **V**). We are ahead of most clients (Zed is still on 2025-11-25 **S**); our legacy bridge is what makes us usable *today*.
2. **Ship a search-first "lite catalog" as our headline efficiency feature.** Evidence is overwhelming that 50+ static tools cost 45–70K tokens and accuracy cliffs at 30–50 tools (**V**: Anthropic docs). We build `hub_search_tools → hub_get_schema → hub_call` on the FTS5+vector engine we *already ship* in `src/builtins/knowledge.ts`. No new infra.
3. **Remote-usability gap = OAuth discovery, not transport.** To be "very usable remotely" (ChatGPT/Claude directories), we must expose RFC 9728 Protected Resource Metadata (`.well-known`) and ride the DCR→**CIMD** transition. Our per-user Bearer model already works for dev-mode clients everywhere.
4. **Adopt four things** (official Registry metadata, MCP Apps via `ext-apps`, Cisco `mcp-scanner` in CI, MCP Inspector as dev dep) and **imitate** five patterns (FastMCP transforms, Higress REST→MCP templates, ContextForge plugin chain, Smithery connect-URL UX, Cloudflare code-mode). **Reject** running someone else's gateway sidecar.

---

## Q1 — Standard status (what we must conform to)

**Verified from the official 2026-07-28 changelog (V):**
- Statelessness: `initialize`/`notifications/initialized` handshake and protocol sessions **removed**; each request carries `io.modelcontextprotocol/protocolVersion|clientInfo|clientCapabilities` in `_meta` + `MCP-Protocol-Version` header; routing via `Mcp-Method`/`Mcp-Name` headers. → Our `src/server.ts` handler + smoke tests already speak this.
- `ttlMs` + `cacheScope` required on list results (SEP-2549). → We set these on `tools/list` (60s public) — but should flip to **`private`** scope in platform mode (per-user catalogs) and keep tool ordering deterministic per user (our pure `assembleCatalog` gives this; churn would break clients' prompt caches — cost evidence: reordering tool defs cost 7× per run **S**).
- Tasks graduated to extension `io.modelcontextprotocol/tasks` (SEP-2663). **Roots, Sampling, Logging deprecated** (SEP-2577). HTTP+SSE transport deprecated (SEP-2596) — our SSE bridge is correctly legacy-only.
- Auth: DCR formally deprecated toward **CIMD** (client ID metadata documents, PR #2858); RFC 9207 issuer binding; (RFC 8707/9728 live on the authorization page, not the changelog — reconciled).
- 2025-11-25 (prior rev, for upstream interop): elicitation URL-mode, structured tool output, icon metadata, PRM discovery, tool-aware sampling (now moot).
- MCP Apps: stable official extension, versioned 2026-01-26 (`ui://` resources), production in Claude + ChatGPT **V(partial)** (repo verified **V**, GA dates **S**).
- Ecosystem friction reality: Entra ID / Azure DevOps / AWS Cognito / Slack don't do DCR (**S**) → static bearer tokens (our `mcw_*`) remain the enterprise pragmatic path; CIMD is the forward door.

**Honest position:** no verified evidence any major client has shipped 2026-07-28 *stateless mode* yet (flagged CONFLICTING by the spec agent). Our dual-mode (stateless + legacy) is the correct hedge, not overengineering.

## Q2 — Open-source: adopt / absorb / imitate / skip

All repo stats re-verified today from api.github.com (**V** unless noted).

| Project | Stats (V) | Verdict | The one thing to take |
|---|---|---|---|
| **modelcontextprotocol/registry** | 7,285★ Go, active | **ADOPT** | Publish hub + upstream metadata in registry schema; feed our Directory view from its API instead of proprietary Smithery/mcp.so. |
| **modelcontextprotocol/ext-apps** | 2.9k★ TS, active | **ADOPT** | Render `ui://` tool UIs in our React dashboard — highest user-visible win. |
| **cisco-ai-defense/mcp-scanner** | 1,079★ Py, active (**S** — API 403'd on my recount) | **ADOPT in CI** | Scan registered upstream servers on add; plug into our healthcheck module. |
| **IBM/mcp-context-forge** | 4,529★ Py, pushed today | **IMITATE** | Plugin handler-chain (pre-routing transforms/filters) + TOON-style payload compression. |
| **Docker MCP Gateway** | 1,584★ Go | **IMITATE + interop** | Container isolation story; secrets never in env (we already do better: per-user encrypted). Be compatible with `docker mcp` catalog entries. |
| **mozilla-ai/mcpd** | 182★ Go, active | **SKIP (validate)** | Its daemon lease/locking model independently validates our single-flight + TTL/LRU pooling. Not worth a Go sidecar. |
| **Higress** | 9,456★ Go | **IMITATE** | REST/OpenAPI→MCP declarative templates → our "import any REST API as a builtin module" feature. Skip the Envoy stack. |
| **FastMCP (proxy/transforms)** | 27,898★ Py | **IMITATE** | Declarative tool rename/filter transforms; pluggable auth-provider interface. |
| **Smithery (under Arcade)** | CLI 836★ AGPL, semi-dormant | **SKIP code, IMITATE UX** | "Connect once → get a user-scoped URL" onboarding — our Connect view should end with exactly that. |
| **mcp-tools** (search-first aggregator) | **source gone (404, V)** | **PATTERN ONLY** | search-first lazy schema exposure is the doctrine of Q3; live analogues: LiteLLM lazy loading, FastMCP tool-search transform. |
| Cloudflare workers-sdk mcp-router-server, mcp-server-cloudflare | 4.5k★ TS each (S) | **ADOPT as conformance target** | Stateless serverless reference behavior to test our hub against. |
| MCPMaster / intent-io ContextForge / Invariant / glama OSS / milind-soni mcpd | dead/404/stale (V) | **SKIP** | Nonexistent or dormant. |

**Rejected wholesale: "run ContextForge/mcpgateway alongside."** They're Python/Go multi-tenant enterprise gateways with Redis/Postgres backends — we'd dual-maintain auth, prefs, and pooling that our TS core already owns natively, and lose the per-user-credential layering that is our differentiator.

## Q3 — The integration doctrine: small footprint, full capability, remote-first

**The numbers that decide the design (V = verified directly):**
- **V** Anthropic: typical multi-tool setups burn ~55K tokens pre-conversation; accuracy "drops sharply" at 30–50 tools; Tool Search cuts >85%, max 10,000 deferred tools, ≥1 tool must stay visible, default 5 results (regex + bm25 variants).
- **S** Anthropic Advanced Tool Use: 134K→8.7K tool-definition tokens; eval accuracy 49%→74% (Opus 4) / 79.5%→88.1% (Opus 4.5). Cloudflare Code Mode: 2,500 endpoints ≈ >2M tokens → ~1,000 with 2 tools.
- **S** The counterweight: Arcade stress test — retrieval selected the right tool only **56% (regex) / 64% (bm25)** across 4,027 tools; MCP-Universe: frontier agents still solve <44% of real multi-server tasks. And "descriptions are smelly" (97.1% of 856 audited descriptions flawed; cleanup +5.85pp but +67% steps). **Lazy exposure without good descriptions is a trap — description quality work is part of the feature.**
- **S** SEP-2567 sessionless (Final 2026-03-11): surveyed 1,000 servers — 90% never referenced the session id. Our zero-session design is spec-aligned and serverless-native.
- **S** Process economics: OpenAI Codex bug — ~900 leaked MCP node processes ≈ 10GB RSS (≈11MB/process). Confirms per-user stdio pools must be TTL-evicted (ours are) and that stdio-per-user isolation is paid in RSS we *want* to spend on multi-tenant safety.
- **V** Claude Code caps MCP tool output at 25K tokens (`MAX_MCP_OUTPUT_TOKENS`) — clients truncate us today; we should return structured "result too large → use fs handle" responses (our `filesystem` + `knowledge` modules make this cheap).

**The doctrine we adopt (search-first, two-tier catalog):**
- Tier 0 (always visible, ≤8 tools): `hub_search_tools`, `hub_get_tool`, `hub_call`, `workstation_status`, `workstation_reload`, `fs_read` (handles), `skills_list` — plus auth/meta.
- Tier 1 (discoverable): everything else — 45+ builtins + all upstream tools — indexed in SQLite FTS5 + vectors (reuse `knowledge.ts` engine), namespaced as today.
- `tools/list` in lite mode = Tier 0 only with `cacheScope:"private"`; full-mode stays available per-user (power clients, evals).
- Retrieval is ours to build well: BM25 + existing embedding path, rerank by module popularity + user prefs; feed the "smells" lesson into per-tool description linting in the dashboard.

**Remote-first checklist for `/mcp`:**
1. Bearer `mcw_*` per user — works in ChatGPT dev-mode / Cursor / Claude Code header configs today.
2. Add `GET /.well-known/oauth-protected-resource` (RFC 9728, spec-MUST **V**) advertising our authorization server; then an OAuth facade that issues per-user tokens for directory-listing clients (CIMD-ready metadata doc at `/.well-known/oauth-client-*.json` path convention — build before 2027 when DCR dies **S**).
3. Return `Retry-After` + rate-limit headers on 429 (no ecosystem convention exists **S** — we can set one).
4. One-click install artifacts: registry-compliant JSON, `mcp.json` snippet generation (our Connect view already has per-client configs), Cursor deep link (UNVERIFIED format — needs a 30-min check before sprint 3).

## What we're trading away (honest risk table)

| Choice | Cost / risk | Mitigation |
|---|---|---|
| Search-first lite catalog | Naive clients see few tools; retrieval miss ≈36–44% (Arcade **S**); discovery UX burden | Tier-0 includes search + status; per-user opt-out to full catalog; invest in description quality + module synonyms in the index |
| Per-user catalogs (spec says availability "MUST NOT vary per-connection" **V**) | Strictly, our per-user views vary per *authn*, not per connection — defensible (identity is in the request envelope) but novel | Keep per-user catalog deterministic + documented; watch spec clarification on progressive discovery roadmap (2026-08 **S**) |
| OAuth facade for directories | Real lift: authorization server, consent UI, review processes (Stripe requires "Agent"-tagged keys by 2026-10-31 **S** — enterprise norms tightening) | Phase 4; Bearer path ships value first |
| MCP Apps rendering | `ui://` HTML = new XSS surface in our dashboard | Sandboxed iframe, CSP, no eval; follow ext-apps security guidance |
| Keeping the legacy SSE bridge | Deprecated transport (SEP-2596), maintenance debt | 12-month deprecation policy mirrors spec; announce sunset date with conformance dashboard |
| No sidecar gateway | We forgo ContextForge's 40+ plugins overnight | Plugin-chain pattern in our own middleware registry |

## The 4-sprint integration ladder (ranked by leverage)

**S1 — Lite catalog (token story). Highest ROI, touches only our code.** ✅ SHIPPED 2026-09-25
- `hub_search_tools` / `hub_get_tool` / `hub_call` meta-tools; tool index built in `assembleCatalog` into a per-user SQLite FTS5 table + embedding cache (reuse `knowledge.ts` engine, `src/server.ts`).
- `prefs.liteCatalog` toggle (default ON for new users); `cacheScope:"private"`; deterministic tool order + catalog hash in status.
- Evals: 20-task probe suite (search→call accuracy) in `scripts/`, run pre/post.
- **Shipped as:** `src/toolsearch.ts` (in-memory BM25 + `MODULE_ALIASES` synonym layer — replaced the FTS5/embedding plan: per-request indexes don't need disk or a model download; 20-probe accuracy suite gates at ≥90% in `tests/toolsearch.test.ts`), lite split in `assembleCatalog`, shared `runTool` pipeline (rate-limit→audit→spill) + 3 hub tools in `createMcpInstance`, `lite_catalog` prefs column + API + dashboard toggle, result-size spill (`MAX_RESULT_BYTES`, S2 item landed early), E2E section in `smoke-platform.mjs` (8 new checks incl. new-user default).

**S2 — 2026-07-28 conformance + remote hardening.** ✅ shipped 2026-09-25
- ✅ `/.well-known/oauth-protected-resource` (RFC 9728) + `resource_metadata` in every 401 challenge. ✅ Result-size guardrails (spill + `structuredContent` pointer + control-plane exemption). ✅ **Full OAuth 2.1 authorization server**: AS metadata, RFC 7591 DCR (`POST /register`, loopback-http/https redirect validation), session-gated consent page, mandatory PKCE S256, single-use 5-min codes, tokens minted into the existing hashed `mcw_` store (shown/revocable on the Tokens page), pre-login flow parking with dashboard continuation; PRM now advertises `authorization_servers`. E2E: 11 checks incl. wrong-verifier reject, code-reuse reject, anonymous-authorize redirect.
- Deliberately remaining: MRTR/elicitation + `subscriptions/listen` passthrough; live conformance runs vs Cloudflare router-server/Inspector (needs network fixtures). HTTP-level 429 `Retry-After`: our limiter lives at tool-call level; the retry hint ships inside the tool error instead.

**S3 — Registry + Apps visibility.** ✅ shipped 2026-09-25
- ✅ Directory live-searches the official registry (`GET /api/registry` proxy, session-gated, https-only flattening) with one-click "add as upstream" — E2E-verified against the real registry.
- ✅ Publish-ready `registry/server.json` (`io.github.anshace/mcp-workstation`), validated offline against the vendored official schema (`npm run validate:registry`, in `check`). Submission needs a deployed public URL + namespace claim — operator step.
- ✅ MCP Apps: upstream `_meta` + title pass-through AND **resources proxy** (`resources/list`/`read` with verbatim URIs, collision-safe, capability advertised only when present) — the protocol surface app-capable clients (Claude/ChatGPT) need to render `ui://` tool UIs through the hub, E2E-proven with a `ui://demo/echo` fixture.
- Deferred with reason: Cursor documents no install-deeplink format (verified against cursor.com/docs/mcp — not invented); in-dashboard `ui://` rendering would require embedding an MCP client in the dashboard; clients do this natively via the proxied resources.

**S4 — Capability multipliers.** ◐ partial
- ✅ Description-quality linter (`src/descli.ts`, arXiv-2602.14878 rules, unit-tested) surfaced in every `workstation_status` as `descriptionQuality {score, flagged}`. ✅ CI workflow (`.github/workflows/ci.yml`, Node 22/24 matrix: check + builds + all three smokes) + verified Cisco mcp-scanner commands documented in CONTRIBUTING.
- Remaining: REST/OpenAPI→MCP importer (needs its own storage/CRUD design); tasks-extension passthrough.

## Appendix — where the agents' reports conflicted and what I did
- 2026-07-28 "final/GA": changelog page I fetched didn't say GA; blog post (agent **S**) says final/GA. Treated as ratified spec (it IS the current spec version) — GA wording flagged **S**.
- RFC 9707/9728 "MUST in changelog": changelog (V) mentions only issuer-binding/RFC-9207 + CIMD shift; the 97xx MUSTs live on the authorization page. Corrected above.
- ext-apps 2,872★ (agent) vs 2.9k (my page read): same number, different rounding. **V**.
- mcp-tools author "fryrise" — repo 404 under every guess; treated as defunct (**V** 404s).
- GitHub API 403 mid-check → switched to page fetches; affected items marked **S**.
