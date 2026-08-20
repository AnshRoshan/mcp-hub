import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { num, str } from "../utils.js";

/**
 * Crypto module — CoinGecko public API, no API key required.
 * Rate-limited (≈10-30 req/min for the free tier), so calls are light.
 */

const BASE = "https://api.coingecko.com/api/v3";

async function cg(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "mcp-workstation/0.2" },
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error("CoinGecko rate limit reached — wait a moment and retry");
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`CoinGecko API error ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("CoinGecko request timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize a symbol like "BTC", "btc", or "bitcoin" to CoinGecko ids + symbols. */
function parseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").split(",")[0].trim();
}

export const cryptoDefs: ToolDef[] = [
  {
    name: "crypto_price",
    description:
      "Get the current price and basic market data for one or more cryptocurrencies (BTC, ETH, SOL, …). Returns price, 24h change, market cap and volume for each requested coin, converted into one or more currencies (usd, eur, inr, …).",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "string",
          description: "Comma-separated coin ids or symbols, e.g. \"bitcoin,ethereum,solana\" or \"btc,eth\"",
        },
        vs_currencies: {
          type: "string",
          description: "Comma-separated fiat currencies (default \"usd\")",
        },
      },
      required: ["ids"],
    },
    handler: async (args) => {
      const ids = str(args.ids, "bitcoin");
      const vs = str(args.vs_currencies, "usd");
      const data = (await cg(
        `/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}` +
          "&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true&include_last_updated_at=true",
      )) as Record<string, Record<string, number>>;
      return jsonResult({ coins: data });
    },
  },
  {
    name: "crypto_market",
    description:
      "List the top cryptocurrencies ranked by market cap. Returns rank, symbol, current price, 24h change and market cap for each.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "How many coins to return (default 10)" },
        vs_currency: { type: "string", description: "Fiat currency for prices (default \"usd\")" },
        order: {
          type: "string",
          enum: ["market_cap_desc", "volume_desc", "gecko_desc", "gecko_asc"],
          description: "Sort order (default market_cap_desc)",
        },
      },
    },
    handler: async (args) => {
      const limit = Math.min(num(args.limit, 10), 100);
      const vs = str(args.vs_currency, "usd");
      const order = str(args.order, "market_cap_desc");
      const data = (await cg(
        `/coins/markets?vs_currency=${encodeURIComponent(vs)}&order=${encodeURIComponent(order)}` +
          `&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      )) as unknown[];
      return jsonResult({
        coins: data.map((c) => {
          const coin = c as Record<string, unknown>;
          return {
            rank: coin.market_cap_rank,
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price: coin.current_price,
            market_cap: coin.market_cap,
            volume_24h: coin.total_volume,
            change_24h_pct: coin.price_change_percentage_24h,
          };
        }),
      });
    },
  },
  {
    name: "crypto_trending",
    description:
      "What the crypto market is watching right now — CoinGecko's trending searches. Returns the top 7 trending coins with their market cap rank and price.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const data = (await cg("/search/trending")) as { coins?: unknown[] };
      return jsonResult({
        trending: (data.coins ?? []).map((c) => {
          const item = c as { item?: Record<string, unknown> };
          const it = item.item ?? {};
          return {
            id: it.id,
            name: it.name,
            symbol: it.symbol,
            market_cap_rank: it.market_cap_rank,
            price_btc: it.price_btc,
          };
        }),
      });
    },
  },
  {
    name: "crypto_search",
    description:
      "Search CoinGecko's coin database by name or symbol (e.g. \"chainlink\", \"link\", \"dogecoin\"). Returns matching coins with their id — use the id with crypto_price / crypto_market.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Coin name or symbol to search for" } },
      required: ["query"],
    },
    handler: async (args) => {
      const query = str(args.query, "");
      const data = (await cg(`/search?query=${encodeURIComponent(query)}`)) as { coins?: unknown[] };
      return jsonResult({
        coins: (data.coins ?? []).slice(0, 10).map((c) => {
          const coin = c as Record<string, unknown>;
          return { id: coin.id, name: coin.name, symbol: coin.symbol, market_cap_rank: coin.market_cap_rank };
        }),
      });
    },
  },
  {
    name: "crypto_convert",
    description:
      "Convert an amount between any two supported currencies (crypto or fiat), e.g. 5 BTC → USD or 1000 INR → ETH.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount to convert" },
        from: { type: "string", description: "Source currency: crypto symbol or fiat code, e.g. \"btc\" or \"usd\"" },
        to: { type: "string", description: "Target currency, e.g. \"usd\", \"inr\", \"eth\"" },
      },
      required: ["amount", "from", "to"],
    },
    handler: async (args) => {
      const amount = num(args.amount, 1);
      const from = parseQuery(str(args.from, "btc"));
      const to = parseQuery(str(args.to, "usd"));
      // Resolve symbol → id when the source looks like a crypto symbol.
      let fromId = from;
      if (from.length <= 6 && from !== "usd" && from !== "eur" && from !== "inr" && from !== "gbp" && from !== "jpy") {
        const search = (await cg(`/search?query=${encodeURIComponent(from)}`)) as { coins?: { id: string; symbol: string }[] };
        const hit = (search.coins ?? []).find((c) => c.symbol.toLowerCase() === from);
        if (hit) fromId = hit.id;
      }
      const res = (await cg(`/simple/price?ids=${encodeURIComponent(fromId)}&vs_currencies=${encodeURIComponent(to)}`)) as Record<
        string,
        Record<string, number>
      >;
      const rate = res[fromId]?.[to];
      if (rate === undefined) {
        throw new Error(`Could not convert ${from} → ${to}: currency not recognized (CoinGecko: ${JSON.stringify(res)})`);
      }
      return jsonResult({
        from,
        to,
        amount,
        rate,
        result: +(amount * rate).toFixed(8),
      });
    },
  },
];
