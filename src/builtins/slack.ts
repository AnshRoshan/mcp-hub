import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { httpJson, num, str } from "../utils.js";
import type { EnvSource } from "../utils.js";
export function slackModule(env: EnvSource): { defs: ToolDef[]; enabled: boolean; reason?: string } {

  const token = env.get("SLACK_BOT_TOKEN");
  const API = "https://slack.com/api/";

  async function slack(pathname: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await httpJson(`${API}${pathname}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    const body = res.body as { ok?: boolean; error?: string };
    if (res.status >= 400 || (body && body.ok === false)) {
      throw new Error(`Slack ${pathname} failed: ${body.error ?? `HTTP ${res.status}`}`);
    }
    return body;
  }

  const slackDefs: ToolDef[] = [
    {
      name: "slack_post_message",
      description: "Post a message to a Slack channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID (e.g. C0123ABC) or name" },
          text: { type: "string" },
          thread_ts: { type: "string", description: "Reply in a thread (timestamp of the parent message)" },
        },
        required: ["channel", "text"],
      },
      handler: (args) =>
        slack("chat.postMessage", {
          channel: str(args.channel),
          text: str(args.text),
          ...(str(args.thread_ts) ? { thread_ts: str(args.thread_ts) } : {}),
        }).then(jsonResult),
    },
    {
      name: "slack_list_channels",
      description: "List public/private Slack channels.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 100" },
          types: { type: "string", description: "Comma list, e.g. public_channel,private_channel (default public_channel)" },
        },
      },
      handler: (args) =>
        slack("conversations.list", {
          limit: num(args.limit, 100),
          types: str(args.types, "public_channel"),
          exclude_archived: true,
        }).then(jsonResult),
    },
    {
      name: "slack_channel_history",
      description: "Get recent messages from a Slack channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20" },
        },
        required: ["channel"],
      },
      handler: (args) =>
        slack("conversations.history", {
          channel: str(args.channel),
          limit: num(args.limit, 20),
        }).then(jsonResult),
    },
    {
      name: "slack_list_users",
      description: "List workspace users.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
      },
      handler: (args) => slack("users.list", { limit: num(args.limit, 100) }).then(jsonResult),
    },
  ];

  const slackEnabled = token
    ? { enabled: true as const }
    : { enabled: false as const, reason: "SLACK_BOT_TOKEN not set" };


  return { defs: slackDefs, ...slackEnabled };
}
