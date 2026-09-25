import type { ToolDef } from "./registry.js";

/**
 * Ephemeral BM25 index over a tool catalog — the retrieval engine behind the
 * lite-catalog hub tools. In-memory (a catalog is a few hundred defs at most,
 * rebuilt per catalog assembly), deterministic, zero dependencies.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "for", "from", "get", "in", "into", "is", "it", "of", "on",
  "or", "the", "to", "with", "you", "your",
]);

/** camelCase / snake_case / kebab / space → lowercase term tokens. */
function splitTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Split, then add bigram phrases so "create issue" also matches "issues". */
function phraseTokens(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Stem-ish plural fold so "repos"↔"repo", "branches"↔"branch" both match. */
function canon(term: string): string {
  if (term.length > 4 && /(ches|shes|xes|zes|ses)$/.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("ies")) return term.slice(0, -3) + "y";
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss") && !term.endsWith("us")) return term.slice(0, -1);
  return term;
}

interface IndexedDoc {
  name: string;
  tf: Map<string, number>;
  length: number;
}

/**
 * Curated user-vocabulary synonyms per builtin module, appended to each tool's
 * index text. Lexical retrieval has no semantic generalization — this table is
 * how "turn bitcoin into dollars" finds `crypto_convert`. Keys match module
 * names (builtins) or are matched by prefix (upstream server keys).
 */
export const MODULE_ALIASES: Record<string, string> = {
  github: "git repo repository code commit pr pull request actions workflow release",
  jira: "ticket board sprint agile backlog status workflow story",
  notion: "page database wiki doc block notes workspace",
  slack: "message channel chat dm notify webhook",
  crypto: "bitcoin ethereum dollars currency price coin token exchange market satoshi",
  weather: "forecast temperature rain snow humidity climate location geocode",
  hn: "hacker news stories thread comments upvote front page",
  memory: "remember recall note fact context store persist",
  knowledge: "documents rag embedding semantic fts bm25 index notes corpus",
  filesystem: "file folder directory path read write create delete workspace ls cat",
  postgres: "sql database table row db select join schema",
  sqlite: "sql database table row db select schema",
  search: "internet web google results browse news lookup extract",
  fetch: "http url webpage api download rest",
  time: "clock date now timestamp timezone utc",
  uuid: "id guid identifier random unique",
  skills: "instruction playbook capability recipe agent skill",
  workstation: "status health modules reload catalog tools servers",
};

/** Per-tool synonym text for the builtins in one module. */
export function aliasesForModule(moduleName: string, defs: ToolDef[]): Map<string, string> {
  const out = new Map<string, string>();
  const alias = MODULE_ALIASES[moduleName.toLowerCase()];
  if (!alias) return out;
  for (const d of defs) out.set(d.name, alias);
  return out;
}

export interface ToolSearchHit {
  name: string;
  score: number;
}

export class ToolIndex {
  private docs: IndexedDoc[];
  /** term → doc-frequency, computed once over the corpus. */
  private df = new Map<string, number>();
  private avgLen: number;

  private static readonly K1 = 1.2;
  private static readonly B = 0.75;

  /** `aliases` adds per-tool synonym text (weight 1) — see MODULE_ALIASES. */
  constructor(defs: ToolDef[], aliases?: Map<string, string>) {
    this.docs = defs.map((def) => {
      const tf = new Map<string, number>();
      let length = 0;
      const bump = (tokens: string[], weight: number) => {
        for (const raw of tokens) {
          const t = canon(raw);
          for (let i = 0; i < weight; i++) {
            tf.set(t, (tf.get(t) ?? 0) + 1);
            length++;
          }
        }
      };
      bump(splitTokens(def.name), 3);
      bump(phraseTokens(def.description), 2);
      if (aliases?.has(def.name)) bump(splitTokens(aliases.get(def.name) ?? ""), 1);
      return { name: def.name, tf, length };
    });
    for (const doc of this.docs) {
      for (const term of doc.tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    this.avgLen = this.docs.length ? this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length : 1;
  }

  /** Top-k hits by BM25 score, tie-broken by name for determinism. */
  search(query: string, limit = 8): ToolSearchHit[] {
    const qTerms = new Map<string, number>();
    for (const raw of [...splitTokens(query), ...phraseTokens(query)]) {
      const t = canon(raw);
      qTerms.set(t, (qTerms.get(t) ?? 0) + 1);
    }
    const n = this.docs.length;
    const scores: ToolSearchHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const [term, qTf] of qTerms) {
        const tf = doc.tf.get(term);
        if (!tf) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = tf * (ToolIndex.K1 + 1) * (1 - ToolIndex.B + ToolIndex.B * (doc.length / this.avgLen));
        score += qTf * (idf * norm) / (tf + norm);
      }
      if (score > 0) scores.push({ name: doc.name, score });
    }
    scores.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scores.slice(0, Math.max(1, Math.min(limit, 25)));
  }

  size(): number {
    return this.docs.length;
  }
}
