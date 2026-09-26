/* MCP Directory catalog + connect guide client configs.
   Real, well-known MCP servers grouped by category. Install commands come from
   each server's official docs — verify in the docs before relying on them. */

export interface CatalogEntry {
  name: string;
  desc: string;
  transport: "stdio" | "http";
  cmd: string;
  env: string[];
  by: "official" | "reference" | "community";
}

export const MCP_CATALOG: Record<string, CatalogEntry[]> = {
  "AI & Models": [
    { name: "OpenAI", desc: "Chat Completions, responses, images, and assistants from OpenAI models directly in your agent.", transport: "stdio", cmd: "npx -y @openai/mcp", env: ["OPENAI_API_KEY"], by: "official" },
    { name: "Anthropic", desc: "Claude models and the full Anthropic API — text, tools, and structured outputs.", transport: "stdio", cmd: "npx -y @anthropic-ai/mcp-server", env: ["ANTHROPIC_API_KEY"], by: "official" },
    { name: "Hugging Face", desc: "Search models, datasets, and spaces; run inference and manage your HF account.", transport: "stdio", cmd: "npx -y @huggingface/mcp-server", env: ["HF_TOKEN"], by: "official" },
    { name: "OpenRouter", desc: "One API key for hundreds of models across providers — chat and completion calls.", transport: "stdio", cmd: "npx -y @openrouter/mcp", env: ["OPENROUTER_API_KEY"], by: "official" },
  ],
  "Development & Git": [
    { name: "GitHub", desc: "Official GitHub server — issues, PRs, repos, workflows, and code search under your token.", transport: "stdio", cmd: "docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server", env: ["GITHUB_PERSONAL_ACCESS_TOKEN"], by: "official" },
    { name: "Git", desc: "Reference git server — status, diffs, commits, branches, and blame over MCP.", transport: "stdio", cmd: "uvx mcp-server-git", env: [], by: "reference" },
    { name: "Linear", desc: "Issue tracking for modern teams — create, triage, and search Linear issues.", transport: "stdio", cmd: "npx -y linear-mcp-server", env: ["LINEAR_API_KEY"], by: "official" },
    { name: "Sentry", desc: "Errors and performance — pull issues, stack traces, and release health.", transport: "stdio", cmd: "npx -y @sentry/mcp-server", env: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"], by: "official" },
    { name: "Everything", desc: "The reference test server — every MCP tool type (echo, prompts, resources, sampling) for exercising clients.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-everything", env: [], by: "reference" },
  ],
  "Web & Search": [
    { name: "Brave Search", desc: "Privacy-first web search API — web, news, images, and videos.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-brave-search", env: ["BRAVE_API_KEY"], by: "reference" },
    { name: "Exa", desc: "Neural web search built for AI — semantic search, content, and links.", transport: "stdio", cmd: "npx -y exa-mcp-server", env: ["EXA_API_KEY"], by: "official" },
    { name: "Tavily", desc: "Search API tuned for LLM retrieval — answers, scraping, and extract.", transport: "stdio", cmd: "npx -y tavily-mcp", env: ["TAVILY_API_KEY"], by: "official" },
    { name: "Firecrawl", desc: "Turn any URL into clean markdown or structured data — crawling and scraping for agents.", transport: "stdio", cmd: "npx -y firecrawl-mcp", env: ["FIRECRAWL_API_KEY"], by: "official" },
    { name: "Fetch", desc: "Reference HTTP client — fetch a URL and return its content to the model.", transport: "stdio", cmd: "uvx mcp-server-fetch", env: [], by: "reference" },
  ],
  Databases: [
    { name: "PostgreSQL", desc: "Query a Postgres database — introspect schemas, run read-only SQL, and inspect tables.", transport: "stdio", cmd: "uvx mcp-server-postgres --connection-string postgresql://USER:PASS@HOST:5432/DB", env: [], by: "community" },
    { name: "SQLite", desc: "Reference SQLite server — read and write a local .db file with parameterized SQL.", transport: "stdio", cmd: "uvx mcp-server-sqlite --db-path /tmp/example.db", env: [], by: "reference" },
    { name: "Supabase", desc: "Manage Supabase projects — databases, auth, storage, and edge functions.", transport: "stdio", cmd: "npx -y @supabase/mcp-server-supabase", env: ["SUPABASE_ACCESS_TOKEN"], by: "official" },
    { name: "Neon", desc: "Serverless Postgres — manage branches, connections, and databases in Neon.", transport: "stdio", cmd: "npx -y @neondatabase/mcp-server-neon", env: ["NEON_API_KEY"], by: "official" },
    { name: "MongoDB", desc: "Query and manage MongoDB — collections, documents, and aggregation pipelines.", transport: "stdio", cmd: "npx -y mcp-mongo-server", env: ["MONGODB_URI"], by: "community" },
    { name: "DuckDB", desc: "In-process analytical SQL — query parquet, CSV, and JSON files without a server.", transport: "stdio", cmd: "uvx mcp-server-duckdb", env: [], by: "official" },
    { name: "Prisma", desc: "Your database schema and data through Prisma — introspect, migrate, and query.", transport: "stdio", cmd: "npx -y @prisma/mcp", env: ["DATABASE_URL"], by: "official" },
  ],
  Communication: [
    { name: "Slack", desc: "Official Slack server — post and read messages, list channels, and search workspaces.", transport: "stdio", cmd: "npx -y @slack/mcp-server-oauth", env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], by: "official" },
    { name: "Discord", desc: "Official Discord server — send and read messages, manage channels and members.", transport: "stdio", cmd: "npx -y mcp-discord", env: ["DISCORD_TOKEN"], by: "official" },
    { name: "Gmail", desc: "Read, search, and draft email through Gmail — with an app password.", transport: "stdio", cmd: "uvx --from mcp-gmail mcp-gmail", env: ["GMAIL_USERNAME", "GMAIL_APP_PASSWORD"], by: "community" },
  ],
  "Productivity & Docs": [
    { name: "Notion", desc: "Reference Notion server — pages, databases, and search across your workspace.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-notion", env: ["NOTION_TOKEN"], by: "reference" },
    { name: "Obsidian", desc: "Read and write notes in a local Obsidian vault — the plugin API over MCP.", transport: "stdio", cmd: "npx -y obsidian-mcp", env: ["OBSIDIAN_API_KEY", "OBSIDIAN_HOST", "OBSIDIAN_PATH"], by: "community" },
    { name: "Atlassian", desc: "Jira + Confluence together — issues, boards, sprints, pages, and spaces.", transport: "stdio", cmd: "uvx mcp-atlassian", env: ["ATLASSIAN_URL", "PERSONAL_ACCESS_TOKEN"], by: "community" },
  ],
  "Design & Media": [
    { name: "Figma", desc: "Official Figma server — read files, frames, and variables; comment and inspect designs.", transport: "stdio", cmd: "npx -y figma-developer-mcp --stdio", env: ["FIGMA_API_KEY"], by: "official" },
    { name: "FFmpeg", desc: "Inspect and transform audio and video files with FFmpeg through MCP tools.", transport: "stdio", cmd: "npx -y mcp-ffmpeg", env: [], by: "community" },
    { name: "ImageMagick", desc: "Convert, resize, and analyze images with ImageMagick commands.", transport: "stdio", cmd: "npx -y mcp-imagemagick", env: [], by: "community" },
  ],
  "DevOps & Cloud": [
    { name: "AWS", desc: "Official AWS server — EC2, S3, Lambda, and more under your configured credentials.", transport: "stdio", cmd: "npx -y @aws/mcp", env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"], by: "official" },
    { name: "Docker", desc: "Official Docker gateway — inspect containers, images, and volumes on the local daemon.", transport: "stdio", cmd: "docker run -i --rm -v /var/run/docker.sock:/var/run/docker.sock docker/mcp-gateway", env: [], by: "official" },
    { name: "Cloudflare", desc: "Manage Cloudflare — DNS, workers, pages, and account resources.", transport: "stdio", cmd: "npx -y @cloudflare/mcp-server-cloudflare", env: ["CLOUDFLARE_API_TOKEN"], by: "official" },
    { name: "Grafana", desc: "Dashboards, datasources, and incidents — read and manage Grafana resources.", transport: "stdio", cmd: "npx -y mcp-grafana", env: ["GRAFANA_URL", "GRAFANA_API_KEY"], by: "official" },
  ],
  "Browser Automation": [
    { name: "Playwright", desc: "Official Microsoft server — drive real browsers: navigate, click, screenshot, and test.", transport: "stdio", cmd: "npx -y @playwright/mcp@latest", env: [], by: "official" },
    { name: "Puppeteer", desc: "Reference Puppeteer server — headless Chrome automation and page snapshots.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-puppeteer", env: [], by: "reference" },
    { name: "Chrome DevTools", desc: "Official Chrome team server — inspect pages, run JS, capture traces and screenshots.", transport: "stdio", cmd: "npx -y chrome-devtools-mcp@latest", env: [], by: "official" },
    { name: "Browserbase", desc: "Cloud browsers for agents — sessions, navigation, and DOM inspection without a local browser.", transport: "stdio", cmd: "npx -y @browserbasehq/mcp", env: ["BROWSERBASE_API_KEY"], by: "official" },
  ],
  "Security & QA": [
    { name: "Semgrep", desc: "Static analysis at scale — scan code for security and correctness findings.", transport: "stdio", cmd: "npx -y mcp-server-semgrep", env: ["SEMGREP_API_TOKEN"], by: "official" },
  ],
  "Knowledge & Memory": [
    { name: "Memory", desc: "Reference knowledge graph — persistent entities and relations across sessions.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-memory", env: [], by: "reference" },
    { name: "Sequential Thinking", desc: "Structured problem solving — deliberate reasoning steps with dynamic replanning.", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-sequential-thinking", env: [], by: "reference" },
  ],
  "Finance & Crypto": [
    { name: "Stripe", desc: "Official Stripe server — payments, customers, products, and subscriptions under your key.", transport: "stdio", cmd: "npx -y stripe-mcp-server", env: ["STRIPE_API_KEY"], by: "official" },
    { name: "CoinGecko", desc: "Market data for 15,000+ coins — prices, trends, and market caps.", transport: "stdio", cmd: "npx -y coingecko-mcp-server", env: ["COINGECKO_API_KEY"], by: "official" },
  ],
};

/* Catalog category → server-form category select value. */
export const CATEGORY_MAP: Record<string, string> = {
  "AI & Models": "AI",
  "Development & Git": "Development",
  "Web & Search": "Web & API",
  Databases: "Data",
  Communication: "Communication",
  "Productivity & Docs": "Productivity",
  "Design & Media": "Other",
  "DevOps & Cloud": "Development",
  "Browser Automation": "Development",
  "Security & QA": "Development",
  "Knowledge & Memory": "Other",
  "Finance & Crypto": "Finance & Crypto",
};

export const catalogTotal = () => Object.values(MCP_CATALOG).reduce((n, a) => n + a.length, 0);

/* Built-in module catalog: name → { icon, desc }. */
export const MODULES: Record<string, { icon: string; desc: string }> = {
  time: { icon: "clock", desc: "Current date & time" },
  uuid: { icon: "hash", desc: "UUID generation" },
  fetch: { icon: "globe", desc: "HTTP requests" },
  memory: { icon: "chip", desc: "Persistent memory" },
  filesystem: { icon: "folder", desc: "Sandboxed file access" },
  knowledge: { icon: "search", desc: "Full-text + vector search" },
  github: { icon: "branch", desc: "GitHub (requires token)" },
  jira: { icon: "target", desc: "Jira (requires credentials)" },
  search: { icon: "search", desc: "Web search (requires key)" },
  postgres: { icon: "database", desc: "PostgreSQL (requires DATABASE_URL)" },
  sqlite: { icon: "database", desc: "SQLite queries" },
  notion: { icon: "pen", desc: "Notion (requires token)" },
  slack: { icon: "chat", desc: "Slack (requires token)" },
  crypto: { icon: "hex", desc: "Crypto prices & market data" },
  hn: { icon: "news", desc: "Hacker News stories & search" },
  weather: { icon: "cloud", desc: "Weather & forecasts" },
  devkit: { icon: "wrench", desc: "Regex, diff, cron, JSON, contrast" },
  youtube: { icon: "play", desc: "Video metadata (oEmbed)" },
  skills: { icon: "bulb", desc: "Skills hub — instruction sets for agents" },
};

/* ---- Connect guide clients ---- */

export interface ConnectClient {
  id: string;
  name: string;
  file: string;
  kind: "cmd" | "json";
  build: (mcp: string) => string;
}

export const CLIENTS: ConnectClient[] = [
  {
    id: "claude-code", name: "Claude Code", file: "Terminal", kind: "cmd",
    build: (mcp) =>
      `claude mcp add --transport http workstation ${mcp}\n\n# then send your token on every request:\n# Authorization: Bearer <your-api-token>\n\n# local stdio alternative:\n# claude mcp add --transport stdio workstation npx -y your-local-mcp`,
  },
  {
    id: "claude-desktop", name: "Claude Desktop", file: "claude_desktop_config.json", kind: "json",
    build: (mcp) =>
      `{\n  "mcpServers": {\n    "workstation": {\n      "type": "http",\n      "url": "${mcp}",\n      "headers": {\n        "Authorization": "Bearer <your-api-token>"\n      }\n    }\n  }\n}`,
  },
  {
    id: "cursor", name: "Cursor", file: "~/.cursor/mcp.json", kind: "json",
    build: (mcp) =>
      `{\n  "mcpServers": {\n    "workstation": {\n      "url": "${mcp}",\n      "headers": {\n        "Authorization": "Bearer <your-api-token>"\n      }\n    }\n  }\n}`,
  },
  {
    id: "vscode", name: "VS Code", file: ".vscode/mcp.json", kind: "json",
    build: (mcp) =>
      `{\n  "servers": {\n    "workstation": {\n      "type": "http",\n      "url": "${mcp}",\n      "headers": {\n        "Authorization": "Bearer <your-api-token>"\n      }\n    }\n  }\n}`,
  },
  {
    id: "cline", name: "Cline", file: "cline_mcp_settings.json", kind: "json",
    build: (mcp) =>
      `{\n  "mcpServers": {\n    "workstation": {\n      "type": "http",\n      "url": "${mcp}",\n      "headers": {\n        "Authorization": "Bearer <your-api-token>"\n      }\n    }\n  }\n}`,
  },
  {
    id: "windsurf", name: "Windsurf", file: "~/.codeium/windsurf/mcp_config.json", kind: "json",
    build: (mcp) =>
      `{\n  "mcpServers": {\n    "workstation": {\n      "type": "http",\n      "url": "${mcp}",\n      "headers": {\n        "Authorization": "Bearer <your-api-token>"\n      }\n    }\n  }\n}`,
  },
  {
    id: "generic", name: "Any stdio client", file: "mcpServers entry", kind: "json",
    build: () =>
      `// Most stdio clients accept a local command instead of a URL:\n{\n  "mcpServers": {\n    "workstation": {\n      "command": "node",\n      "args": ["/path/to/workstation/index.js", "--stdio"],\n      "env": {}\n    }\n  }\n}`,
  },
];

/* Icon name per category. Covers built-in module categories (backend), skill
   categories (skills/*.md), and MCP Directory categories (this file). */
export const CATEGORY_ICONS: Record<string, string> = {
  // Built-in module categories (src/server.ts).
  Utilities: "wrench", "Web & API": "globe", "Web & News": "news",
  "Knowledge & Memory": "chip", "Files & Data": "database", Development: "code",
  Productivity: "briefcase", Communication: "chat", "Finance & Crypto": "hex",
  "Skills Hub": "bulb", Operations: "gauge",
  // Skill categories (skills/*.md).
  Research: "search", Writing: "pen", DevOps: "package", Security: "shield",
  Data: "chart", General: "pin",
  // MCP Directory categories (MCP_CATALOG keys).
  "AI & Models": "bolt", "Development & Git": "code", "Web & Search": "globe",
  Databases: "database", "Design & Media": "pen", "DevOps & Cloud": "package",
  "Browser Automation": "play", "Security & QA": "shield", "Productivity & Docs": "briefcase",
};

/* Options for the server form's Category select — the form-side bucket each
   Directory category maps to via CATEGORY_MAP. Keep in display order. */
export const FORM_CATEGORIES = [
  "Development", "Data", "Productivity", "Communication", "Web & API",
  "Finance & Crypto", "AI", "Other",
];
