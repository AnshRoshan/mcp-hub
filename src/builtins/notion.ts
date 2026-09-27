import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { apiClient, num, str } from "../utils.js";
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

  /** Notion's per-rich-text character ceiling. */
  const NOTION_TEXT_LIMIT = 2000;

  /**
   * Page/database ids are interpolated straight into the request path, so an
   * agent-supplied value must not be able to carry separators. Notion ids are
   * 32 hex digits, with or without the canonical dash groups.
   */
  function pageId(value: unknown): string {
    const v = str(value).trim();
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(v)) {
      throw new Error(`Notion id must be a 32-digit hex UUID (got "${v}")`);
    }
    return v;
  }

  /**
   * Split free text into Notion paragraph blocks. Notion caps one rich_text
   * entry at 2000 characters, so a longer paragraph is chunked across blocks
   * rather than cut off — silently dropping the tail of a page was data loss.
   */
  function textToBlocks(text: string): unknown[] {
    const blocks: unknown[] = [];
    for (const para of text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)) {
      for (let i = 0; i < para.length; i += NOTION_TEXT_LIMIT) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: para.slice(i, i + NOTION_TEXT_LIMIT) } }] },
        });
      }
    }
    return blocks;
  }

  const notionDefs: ToolDef[] = [
    {
      name: "notion_search",
      description:
        "Search Notion pages and databases (by title or all, if no query). Page through with " +
        "start_cursor while has_more is true — one call returns at most page_size results.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          page_size: { type: "integer", minimum: 1, maximum: 100 },
          start_cursor: { type: "string", description: "next_cursor from a previous page; omit for the first page" },
        },
      },
      handler: (args) =>
        notion("/search", {
          method: "POST",
          body: JSON.stringify({
            query: str(args.query),
            page_size: Math.min(Math.max(Math.round(num(args.page_size, 10)), 1), 100),
            ...(str(args.start_cursor) ? { start_cursor: str(args.start_cursor) } : {}),
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
      handler: (args) => notion(`/pages/${pageId(args.page_id)}`).then(jsonResult),
    },
    {
      name: "notion_list_block_children",
      description:
        "List the child blocks of a page or block (its content). Page through with start_cursor " +
        "while has_more is true — one call returns at most page_size blocks.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          page_size: { type: "integer", minimum: 1, maximum: 100, description: "Blocks per page (default 100)" },
          start_cursor: { type: "string", description: "next_cursor from a previous page" },
        },
        required: ["block_id"],
      },
      handler: (args) => {
        const query = new URLSearchParams();
        const pageSize = Math.min(Math.max(Math.round(num(args.page_size, 100)), 1), 100);
        query.set("page_size", String(pageSize));
        if (str(args.start_cursor)) query.set("start_cursor", str(args.start_cursor));
        return notion(`/blocks/${pageId(args.block_id)}/children?${query}`).then(jsonResult);
      },
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
