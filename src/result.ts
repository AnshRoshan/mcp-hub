import type { CallToolResult } from "@modelcontextprotocol/server";

/** Build a successful text result. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Build a successful JSON result, pretty-printed. */
export function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
