import type { ToolDef } from "./registry.js";

/**
 * Deterministic description-quality linter — the practical subset of the
 * smell taxonomy in arXiv 2602.14878 ("MCP Tool Descriptions Are Smelly",
 * 97.1% of audited descriptions flawed). Runs at catalog assembly; cheap
 * (regexes over ≤ a few hundred short strings) and side-effect free.
 */

export interface DescriptionSmell {
  tool: string;
  issues: string[];
}

const VAGUE = /\b(stuff|things|etc\.?|misc|miscellaneous|various|some data)\b/i;
const QUERY_INTENT = /^(get|list|search|fetch|find|query|read|show|lookup|describe)/i;
const RESULT_HINT = /\b(returns?|provides?|outputs?|list of|details?|results?|each|summary)\b/i;
const EXAMPLE_HINT = /\b(e\.g\.|for example|such as|example)\b/i;

export function lintDescriptions(defs: ToolDef[]): DescriptionSmell[] {
  const issuesByTool = new Map<string, string[]>();
  const add = (tool: string, issue: string) => {
    const arr = issuesByTool.get(tool) ?? [];
    arr.push(issue);
    issuesByTool.set(tool, arr);
  };

  const firstSeen = new Map<string, string>();
  for (const def of defs) {
    const d = def.description ?? "";
    const trimmed = d.trim();

    if (trimmed.length < 12) add(def.name, "too-short");
    if (d.length > 600) add(def.name, "too-long");
    if (trimmed.length >= 12 && !/[.!?]$/.test(trimmed)) add(def.name, "no-terminal-punctuation");
    if (VAGUE.test(d)) add(def.name, "vague-words");
    if (QUERY_INTENT.test(trimmed) && !RESULT_HINT.test(d)) add(def.name, "query-tool-without-result-description");

    const props = (def.inputSchema as { properties?: Record<string, unknown> })?.properties;
    const hasGuidance = EXAMPLE_HINT.test(d) || RESULT_HINT.test(d) || /\b(one of|either|must be|can be|accepts|options?:)/i.test(d);
    if (props && Object.keys(props).length >= 3 && !hasGuidance) {
      add(def.name, "many-params-without-guidance");
    }

    const key = trimmed.toLowerCase();
    if (key.length > 12) {
      const first = firstSeen.get(key);
      if (first) {
        add(def.name, `duplicate-of:${first}`);
        add(first, "has-duplicate-twin");
      } else {
        firstSeen.set(key, def.name);
      }
    }
  }

  return defs
    .filter((d) => issuesByTool.has(d.name))
    .map((d) => ({ tool: d.name, issues: issuesByTool.get(d.name)! }));
}

/** 0..1 cleanliness ratio for a catalog. */
export function descriptionScore(defs: ToolDef[], flagged: DescriptionSmell[]): number {
  if (defs.length === 0) return 1;
  return Math.round(((defs.length - flagged.length) / defs.length) * 100) / 100;
}
