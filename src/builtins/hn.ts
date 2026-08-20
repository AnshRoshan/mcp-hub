import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { fetchJson, num, str } from "../utils.js";

/**
 * Hacker News module — public Firebase + Algolia APIs, no key required.
 */

const FIREBASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1";

const getJson = (url: string) => fetchJson(url, "Hacker News");

const ENDPOINTS: Record<string, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

async function listStories(kind: string, limit: number): Promise<unknown> {
  const endpoint = ENDPOINTS[kind] ?? ENDPOINTS.top;
  const ids = (await getJson(`${FIREBASE}/${endpoint}.json`)) as number[];
  const picked = ids.slice(0, Math.min(limit, 50));
  const items = await Promise.all(picked.map((id) => getJson(`${FIREBASE}/item/${id}.json`)));
  return items.map((raw) => {
    const it = raw as Record<string, unknown> | null;
    if (!it) return null;
    return {
      id: it.id,
      title: it.title,
      url: it.url ?? null,
      score: it.score ?? 0,
      by: it.by ?? null,
      time: it.time ?? null,
      descendants: it.descendants ?? 0,
      type: it.type ?? "story",
      hnUrl: `https://news.ycombinator.com/item?id=${it.id}`,
    };
  });
}

export const hnDefs: ToolDef[] = [
  {
    name: "hn_top",
    description:
      "The current top stories on Hacker News. Returns title, URL, score, author, comment count and a link to the HN thread.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many stories (default 10)" } },
    },
    handler: async (args) => jsonResult({ stories: await listStories("top", num(args.limit, 10)) }),
  },
  {
    name: "hn_new",
    description:
      "The newest stories on Hacker News (not ranked — just posted). Returns the same shape as hn_top.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many stories (default 10)" } },
    },
    handler: async (args) => jsonResult({ stories: await listStories("new", num(args.limit, 10)) }),
  },
  {
    name: "hn_ask",
    description: "The latest 'Ask HN' threads — community questions and discussions.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many threads (default 10)" } },
    },
    handler: async (args) => jsonResult({ threads: await listStories("ask", num(args.limit, 10)) }),
  },
  {
    name: "hn_show",
    description: "The latest 'Show HN' posts — projects and products people are showing off.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many posts (default 10)" } },
    },
    handler: async (args) => jsonResult({ posts: await listStories("show", num(args.limit, 10)) }),
  },
  {
    name: "hn_item",
    description:
      "Fetch a single Hacker News item (story or comment) by id, including its full text and (for stories) the top-level comments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "HN item id" },
        comments: { type: "integer", minimum: 0, maximum: 50, description: "How many top-level comments to include (default 5)" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = num(args.id, 0);
      const raw = (await getJson(`${FIREBASE}/item/${id}.json`)) as Record<string, unknown> | null;
      if (!raw) throw new Error(`HN item ${id} not found`);
      const comments = num(args.comments, 5);
      const kids = (raw.kids as number[] | undefined) ?? [];
      const topComments = await Promise.all(
        kids.slice(0, Math.min(comments, 50)).map(async (kid) => {
          const c = (await getJson(`${FIREBASE}/item/${kid}.json`)) as Record<string, unknown> | null;
          return c ? { id: c.id, by: c.by, time: c.time, text: c.text } : null;
        }),
      );
      return jsonResult({
        id: raw.id,
        type: raw.type,
        title: raw.title,
        text: raw.text,
        url: raw.url,
        by: raw.by,
        score: raw.score,
        time: raw.time,
        descendants: raw.descendants,
        hnUrl: `https://news.ycombinator.com/item?id=${id}`,
        topComments: topComments.filter(Boolean),
      });
    },
  },
  {
    name: "hn_search",
    description:
      "Search Hacker News with the Algolia API — full-text over stories and comments, sorted by relevance or points. Use for finding discussions about a topic.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Results to return (default 10)" },
        sort: { type: "string", enum: ["relevance", "points", "date"], description: "Sort order (default relevance)" },
        points_min: { type: "integer", description: "Only results with at least this many points" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = str(args.query, "");
      const sort = str(args.sort, "relevance");
      const limit = num(args.limit, 10);
      const tags = sort === "date" ? "search_by_date" : "search";
      const filters: string[] = [];
      if (sort === "points") filters.push("points>0");
      if (args.points_min !== undefined) filters.push(`points>=${num(args.points_min, 0)}`);
      const url =
        `${ALGOLIA}/${tags}?query=${encodeURIComponent(query)}&hitsPerPage=${limit}&tags=story` +
        (filters.length > 0 ? `&numericFilters=${encodeURIComponent(filters.join(","))}` : "");
      const data = (await getJson(url)) as { hits?: unknown[] };
      return jsonResult({
        hits: (data.hits ?? []).map((h) => {
          const hit = h as Record<string, unknown>;
          return {
            title: hit.title,
            url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
            points: hit.points ?? 0,
            author: hit.author,
            num_comments: hit.num_comments ?? 0,
            created_at: hit.created_at,
            hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          };
        }),
      });
    },
  },
];
