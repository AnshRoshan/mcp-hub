import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { num, obj, str } from "../utils.js";

export const fetchDefs: ToolDef[] = [
  {
    name: "fetch_url",
    description:
      "Make an HTTP(S) request and return the response. Use for reading web pages, calling REST APIs, downloading text. Optionally restrict to an allowlist of domains and cap the response size.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to request" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], description: "HTTP method (default GET)" },
        headers: { type: "object", description: "Extra request headers as an object" },
        body: { type: "string", description: "Request body (for POST/PUT/etc.)" },
        timeout_ms: { type: "integer", minimum: 100, maximum: 120000, description: "Timeout in ms (default 30000)" },
        max_bytes: { type: "integer", minimum: 1024, maximum: 10485760, description: "Max response bytes to read (default 1048576)" },
        allowed_domains: {
          type: "array",
          items: { type: "string" },
          description: "If set, only these domains (hostnames) may be requested",
        },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const url = str(args.url);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Invalid URL: "${url}"`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Only http/https URLs are allowed (got "${parsed.protocol}")`);
      }

      const allowed = Array.isArray(args.allowed_domains)
        ? args.allowed_domains.map(String).map((d) => d.toLowerCase())
        : [];
      if (allowed.length > 0 && !allowed.includes(parsed.hostname.toLowerCase())) {
        throw new Error(`Domain "${parsed.hostname}" is not in the allowlist: ${allowed.join(", ")}`);
      }

      const method = str(args.method, "GET").toUpperCase();
      const headers = obj(args.headers) as Record<string, string>;
      const timeoutMs = num(args.timeout_ms, 30_000);
      const maxBytes = num(args.max_bytes, 1_048_576);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: str(args.body) === "" ? undefined : str(args.body),
          redirect: "follow",
          signal: controller.signal,
        });

        // Read up to maxBytes with a hard cap.
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        let truncated = false;
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = maxBytes - total;
            if (value.length > remaining) {
              chunks.push(value.subarray(0, Math.max(remaining, 0)));
              truncated = true;
              reader.cancel().catch(() => {}); // stop downloading — we have enough
              break;
            }
            chunks.push(value);
            total += value.length;
          }
        }
        const text = Buffer.concat(chunks).toString("utf-8");

        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        return jsonResult({
          url: res.url ?? url,
          status: res.status,
          statusText: res.statusText,
          truncated,
          size_bytes: text.length,
          headers: responseHeaders,
          body: text.slice(0, maxBytes),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  },
];
