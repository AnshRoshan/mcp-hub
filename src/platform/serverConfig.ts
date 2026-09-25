/**
 * Server-row codec: the boundary between encrypted DB rows and runtime
 * shapes. Core (aggregator configs) and the dashboard REST API (safe DTOs)
 * both go through here, so neither layer depends on the other.
 */

import { decryptSecret, encryptSecret } from "./crypto.js";
import type { McpServerRow } from "./db.js";
import type { UpstreamServerConfig } from "../config.js";

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Env vars a user may override with their own credentials. Anything else
 * stays server-owned on purpose. This is the single source of truth: the
 * API validates against it and the dashboard renders it.
 */
export interface UserSecretSpec {
  name: string;
  /** Builtin module the credential unlocks (matches the module registry name). */
  module: string;
  label: string;
  hint?: string;
}

export const USER_SECRETS: UserSecretSpec[] = [
  { name: "GITHUB_TOKEN", module: "github", label: "GitHub token", hint: "Personal access token (classic or fine-grained)" },
  { name: "GITHUB_API_URL", module: "github", label: "GitHub API base URL", hint: "Only for GitHub Enterprise Server" },
  { name: "JIRA_BASE_URL", module: "jira", label: "Jira site URL", hint: "e.g. https://yourteam.atlassian.net" },
  { name: "JIRA_EMAIL", module: "jira", label: "Jira account email", hint: "Used with the API token for Basic auth" },
  { name: "JIRA_API_TOKEN", module: "jira", label: "Jira API token" },
  { name: "NOTION_TOKEN", module: "notion", label: "Notion integration token" },
  { name: "SLACK_BOT_TOKEN", module: "slack", label: "Slack bot token", hint: "xoxb-…" },
  { name: "BRAVE_API_KEY", module: "search", label: "Brave Search API key" },
  { name: "TAVILY_API_KEY", module: "search", label: "Tavily API key" },
  { name: "EXA_API_KEY", module: "search", label: "Exa API key" },
];

export const USER_OVERRIDABLE_ENV = new Set(USER_SECRETS.map((s) => s.name));

/** Encrypt a user's secret map ({ENV_NAME: value}) into one DB blob. */
export function encodeSecrets(values: Record<string, string>, secret: string): string {
  return encryptSecret(JSON.stringify(values), secret);
}

/** Decrypt the DB blob back to a plain map (empty object when unset/corrupt). */
export function decodeSecrets(valuesEnc: string | undefined, secret: string): Record<string, string> {
  if (!valuesEnc) return {};
  try {
    const parsed = JSON.parse(decryptSecret(valuesEnc, secret));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && USER_OVERRIDABLE_ENV.has(k)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Encrypt a string-keyed map (server env / headers) for at-rest storage. */
export function encryptStringMap(value: unknown, secret: string): string {
  return encryptSecret(JSON.stringify(value), secret);
}

/** Convert a server row (with encrypted env/headers) into an aggregator config. */
export function rowToConfig(row: McpServerRow, secret: string): UpstreamServerConfig {
  const env = row.envEnc
    ? (safeJson(decryptSecret(row.envEnc, secret)) as Record<string, string>)
    : undefined;
  const headers = row.headersEnc
    ? (safeJson(decryptSecret(row.headersEnc, secret)) as Record<string, string>)
    : undefined;
  if (row.type === "stdio") {
    return {
      key: row.key,
      type: "stdio",
      command: row.command ?? "",
      args: row.args ? (safeJson(row.args) as string[]) : [],
      cwd: row.cwd ?? undefined,
      env,
    };
  }
  return {
    key: row.key,
    type: "http",
    url: row.url ?? "",
    headers,
  };
}

/**
 * Dashboard-safe view of a server row: decrypted only to report WHICH
 * env/header keys are set — never their values.
 */
export function serverDto(row: McpServerRow, secret: string): unknown {
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    category: row.category ?? null,
    command: row.command,
    args: row.args ? (safeJson(row.args) as string[]) : [],
    cwd: row.cwd,
    url: row.url,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    hasEnv: Boolean(row.envEnc),
    hasHeaders: Boolean(row.headersEnc),
    envKeys: row.envEnc
      ? Object.keys(safeJson(decryptSecret(row.envEnc, secret)) as Record<string, unknown>)
      : [],
    headerKeys: row.headersEnc
      ? Object.keys(safeJson(decryptSecret(row.headersEnc, secret)) as Record<string, unknown>)
      : [],
  };
}
