import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { apiClient, str } from "../utils.js";
import type { EnvSource } from "../utils.js";
export function notionModule(env: EnvSource): { defs: ToolDef[]; enabled: boolean; reason?: string } {

  const token = env.get("NOTION_TOKEN");
  const API = "https://api.notion.com/v1";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token ?? ""}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  const notion = apiClient(API, "Notion", headers);

  /** Split free text into Notion paragraph blocks. */
  function textToBlocks(text: string): unknown[] {
    return text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 2000) } }] },
      }));
  }

  const notionDefs: ToolDef[] = [
    {
      name: "notion_search",
      description: "Search Notion pages and databases (by title or all, if no query).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          page_size: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
      handler: (args) =>
        notion("/search", {
          method: "POST",
          body: JSON.stringify({
            query: str(args.query),
            page_size: Number(args.page_size) || 10,
          }),
        }).then(jsonResult),
    },
    {
      name: "notion_get_page",
      description: "Fetch a page's properties and content by ID.",
      inputSchema: {
        type: "object",
        properties: { page_id: { type: "string", description: "Notion page ID (UUID, with or without dashes)" } },
        required: ["page_id"],
      },
      handler: (args) => notion(`/pages/${str(args.page_id)}`).then(jsonResult),
    },
    {
      name: "notion_list_block_children",
      description: "List the child blocks of a page or block (its content).",
      inputSchema: {
        type: "object",
        properties: { block_id: { type: "string" } },
        required: ["block_id"],
      },
      handler: (args) => notion(`/blocks/${str(args.block_id)}/children`).then(jsonResult),
    },
    {
      name: "notion_create_page",
      description: "Create a page under a parent page with a title and optional body text.",
      inputSchema: {
        type: "object",
        properties: {
          parent_page_id: { type: "string", description: "Parent page ID" },
          title: { type: "string" },
          body: { type: "string", description: "Plain text; paragraphs separated by blank lines" },
        },
        required: ["parent_page_id", "title"],
      },
      handler: (args) =>
        notion("/pages", {
          method: "POST",
          body: JSON.stringify({
            parent: { page_id: str(args.parent_page_id) },
            properties: {
              title: { title: [{ type: "text", text: { content: str(args.title) } }] },
            },
            children: str(args.body) ? textToBlocks(str(args.body)) : undefined,
          }),
        }).then(jsonResult),
    },
    {
      name: "notion_append_blocks",
      description: "Append blocks to a page. Pass `blocks` as a JSON array string of Notion block objects.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Page or block ID to append to" },
          blocks: { type: "string", description: "JSON array of Notion block objects" },
        },
        required: ["block_id", "blocks"],
      },
      handler: (args) => {
        let blocks: unknown;
        try {
          blocks = JSON.parse(str(args.blocks));
        } catch {
          throw new Error("`blocks` must be a valid JSON array string");
        }
        if (!Array.isArray(blocks) || blocks.length === 0) {
          throw new Error("`blocks` must be a non-empty JSON array");
        }
        return notion(`/blocks/${str(args.block_id)}/children`, {
          method: "PATCH",
          body: JSON.stringify({ children: blocks }),
        }).then(jsonResult);
      },
    },
  ];

  const notionEnabled = token
    ? { enabled: true as const }
    : { enabled: false as const, reason: "NOTION_TOKEN not set" };


  return { defs: notionDefs, ...notionEnabled };
}
