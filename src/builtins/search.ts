import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { assertOk, httpJson, num, str } from "../utils.js";
import type { EnvSource } from "../utils.js";

type Provider = "brave" | "tavily" | "exa";
export function searchModule(env: EnvSource): { defs: ToolDef[]; enabled: boolean; reason?: string } {

  function pickProvider(): Provider | null {
    if (env.get("BRAVE_API_KEY")) return "brave";
    if (env.get("TAVILY_API_KEY")) return "tavily";
    if (env.get("EXA_API_KEY")) return "exa";
    return null;
  }

  const provider = pickProvider();

  interface SearchHit {
    title: string;
    url: string;
    snippet: string;
  }

  async function braveSearch(query: string, count: number): Promise<SearchHit[]> {
    const q = new URLSearchParams({ q: query, count: String(count), search_lang: "en" });
    const res = await httpJson(`https://api.search.brave.com/res/v1/web/search?${q}`, {
      headers: { "X-Subscription-Token": env.get("BRAVE_API_KEY")!, Accept: "application/json" },
    });
    assertOk(res, "Brave search");
    const body = res.body as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (body.web?.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  }

  async function tavilySearch(query: string, count: number): Promise<SearchHit[]> {
    const res = await httpJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.get("TAVILY_API_KEY"), query, max_results: count }),
    });
    assertOk(res, "Tavily search");
    const body = res.body as { results?: { title?: string; url?: string; content?: string }[] };
    return (body.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
  }

  async function exaSearch(query: string, count: number): Promise<SearchHit[]> {
    const res = await httpJson("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.get("EXA_API_KEY")! },
      body: JSON.stringify({ query, numResults: count }),
    });
    assertOk(res, "Exa search");
    const body = res.body as { results?: { title?: string; url?: string; text?: string }[] };
    return (body.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: (r.text ?? "").slice(0, 500) }));
  }

  async function braveExtract(url: string): Promise<string> {
    const res = await httpJson("https://api.search.brave.com/res/v1/web/extract", {
      method: "POST",
      headers: { "X-Subscription-Token": env.get("BRAVE_API_KEY")!, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url] }),
    });
    assertOk(res, "Brave extract");
    const body = res.body as { results?: { content?: string; description?: string }[] };
    return body.results?.[0]?.content ?? body.results?.[0]?.description ?? "(no extractable content)";
  }

  async function tavilyExtract(url: string): Promise<string> {
    const res = await httpJson("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.get("TAVILY_API_KEY"), urls: [url] }),
    });
    assertOk(res, "Tavily extract");
    const body = res.body as { results?: { raw_content?: string }[] };
    return body.results?.[0]?.raw_content ?? "(no extractable content)";
  }

  async function exaExtract(url: string): Promise<string> {
    const res = await httpJson("https://api.exa.ai/contents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.get("EXA_API_KEY")! },
      body: JSON.stringify({ ids: [url] }),
    });
    assertOk(res, "Exa extract");
    const body = res.body as { results?: { text?: string }[] };
    return body.results?.[0]?.text ?? "(no extractable content)";
  }

  async function plainExtract(url: string): Promise<string> {
    const res = await httpJson(url, {}, 30_000);
    if (res.status >= 400) throw new Error(`Could not fetch ${url} (HTTP ${res.status})`);
    const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);
  }

  const searchDefs: ToolDef[] = [
    {
      name: "web_search",
      description: `Search the web (provider: ${provider ?? "none"}) and return titles, URLs, and snippets.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 20, description: "Number of results (default 8)" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const query = str(args.query);
        const count = Math.min(Math.max(num(args.count, 8), 1), 20);
        const hits =
          provider === "brave" ? await braveSearch(query, count)
          : provider === "tavily" ? await tavilySearch(query, count)
          : provider === "exa" ? await exaSearch(query, count)
          : (() => { throw new Error("No search provider configured. Set BRAVE_API_KEY, TAVILY_API_KEY, or EXA_API_KEY."); })();
        return jsonResult(hits);
      },
    },
    {
      name: "web_extract",
      description: `Fetch a URL and extract its text content (provider: ${provider ?? "none"}). Falls back to raw HTML stripping.`,
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      handler: async (args) => {
        const url = str(args.url);
        let content: string;
        try {
          content =
            provider === "brave" ? await braveExtract(url)
            : provider === "tavily" ? await tavilyExtract(url)
            : provider === "exa" ? await exaExtract(url)
            : await plainExtract(url);
        } catch {
          content = await plainExtract(url); // graceful fallback
        }
        return jsonResult({ url, content });
      },
    },
  ];

  const searchEnabled = provider
    ? { enabled: true as const }
    : { enabled: false as const, reason: "set BRAVE_API_KEY, TAVILY_API_KEY, or EXA_API_KEY" };


  return { defs: searchDefs, ...searchEnabled };
}
