import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolDef } from "../registry.js";
import { jsonResult, textResult } from "../result.js";
import { env, num, str } from "../utils.js";
import { resolveInside } from "./filesystem.js";

const DB_PATH = env("KNOWLEDGE_DB")
  ? path.resolve(process.cwd(), env("KNOWLEDGE_DB")!)
  : path.resolve(process.cwd(), "data", "knowledge.db");

const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2"; // 384-dim, downloaded once and cached locally
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 100;
const BATCH_SIZE = 16;

type EmbedMode = "local" | "tfidf" | "pending";

/* ---------------- storage ---------------- */

let db: DatabaseSync | null = null;
let ftsAvailable = false;

function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      title TEXT,
      body TEXT NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS embeddings(
      doc_id INTEGER PRIMARY KEY REFERENCES docs(id),
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL
    );
  `);
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(doc_id UNINDEXED, title, body)");
    ftsAvailable = true;
  } catch {
    ftsAvailable = false;
  }
  return db;
}

/* ---------------- embedding (local first, TF-IDF fallback) ---------------- */

let embedMode: EmbedMode = "pending";
let embedInit: Promise<boolean> | null = null;
type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;
let embedFn: EmbedFn | null = null;

async function initEmbedder(): Promise<boolean> {
  if (embedMode === "local" || embedMode === "tfidf") return embedMode === "local";
  if (!embedInit) {
    embedInit = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        const extractor = await pipeline("feature-extraction", EMBED_MODEL);
        embedFn = async (texts: string[]): Promise<Float32Array[]> => {
          const out: { dims: number[]; data: Float32Array } = (await extractor(texts, {
            pooling: "mean",
            normalize: true,
          })) as unknown as { dims: number[]; data: Float32Array };
          const dim = out.dims[out.dims.length - 1] ?? 384;
          const vectors: Float32Array[] = [];
          for (let i = 0; i < out.data.length / dim; i++) {
            vectors.push(out.data.subarray(i * dim, (i + 1) * dim));
          }
          return vectors;
        };
        embedMode = "local";
        return true;
      } catch (err) {
        console.error(
          `[knowledge] local embeddings unavailable (${err instanceof Error ? err.message : err}); using TF-IDF fallback. ` +
            "Run once with internet access to download the model for semantic search.",
        );
        embedMode = "tfidf";
        embedFn = null;
        return false;
      }
    })();
  }
  return embedInit;
}

/* ---- TF-IDF fallback (deterministic, offline) ---- */

const STOPWORDS = new Set(
  "a an and are as at be but by for from has he her his i if in into is it its me my no of on or our she so that the their them then there these they this to was we were what when where which who will with you your".split(" "),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function tfidfVector(text: string, idf: Map<string, number>): Float32Array {
  const counts = new Map<string, number>();
  for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  const vec = new Float32Array(idf.size);
  let i = 0;
  for (const term of idf.keys()) {
    const c = counts.get(term);
    if (c) vec[i] = (1 + Math.log(c)) * (idf.get(term) ?? 1);
    i++;
  }
  // L2 normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < vec.length; j++) vec[j] /= norm;
  return vec;
}

/** idf weights over the whole corpus, plus the term→index mapping used as vocab. */
function buildIdf(): Map<string, number> {
  const rows = getDb().prepare("SELECT body FROM docs").all() as { body: string }[];
  const df = new Map<string, number>();
  for (const { body } of rows) {
    for (const term of new Set(tokenize(body))) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const total = Math.max(rows.length, 1);
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((total + 1) / (count + 1)) + 1);
  return idf;
}

/* ---- shared helpers ---- */

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];
  const chunks: string[] = [];
  for (let start = 0; start < cleaned.length; start += size - overlap) {
    chunks.push(cleaned.slice(start, start + size));
  }
  return chunks;
}

function snippet(body: string, query: string, len = 240): string {
  const clean = body.replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return clean.slice(0, len);
  const start = Math.max(0, idx - Math.floor(len / 3));
  return (start > 0 ? "…" : "") + clean.slice(start, start + len) + (start + len < clean.length ? "…" : "");
}

function escapeFts(term: string): string {
  return term.replace(/"/g, "");
}

/** Index one text (chunked) into docs + FTS + embeddings. */
async function indexText(text: string, source: string, title: string): Promise<number> {
  const d = getDb();
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;
  const inserted: number[] = [];
  for (const chunk of chunks) {
    const info = d.prepare("INSERT INTO docs(source, title, body) VALUES (?, ?, ?)").run(source, title, chunk);
    inserted.push(Number(info.lastInsertRowid));
    if (ftsAvailable) {
      d.prepare("INSERT INTO docs_fts(doc_id, title, body) VALUES (?, ?, ?)").run(
        Number(info.lastInsertRowid),
        title,
        chunk,
      );
    }
  }
  // Embeddings (batched). In TF-IDF mode we don't persist vectors — computed at query time.
  const ok = await initEmbedder();
  if (ok && embedFn) {
    const { vectors } = await embedChunks(chunks);
    const ins = d.prepare("INSERT INTO embeddings(doc_id, dim, vector) VALUES (?, ?, ?)");
    for (let i = 0; i < inserted.length; i++) {
      const v = vectors[i];
      if (!v) continue;
      ins.run(inserted[i], v.length, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
  }
  return inserted.length;
}

async function embedChunks(chunks: string[]): Promise<{ vectors: Float32Array[]; mode: EmbedMode }> {
  if (embedFn) {
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      vectors.push(...(await embedFn(chunks.slice(i, i + BATCH_SIZE))));
    }
    return { vectors, mode: "local" };
  }
  const idf = buildIdf();
  const vectors = chunks.map((c) => tfidfVector(c, idf));
  return { vectors, mode: "tfidf" };
}

/* ---- search implementations ---- */

function ftsSearch(query: string, limit: number): { id: number; source: string; title: string; snippet: string; score: number }[] {
  if (!ftsAvailable) return [];
  const terms = query.replace(/["']/g, "").split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${escapeFts(t)}"`).join(" AND ");
  try {
    const rows = getDb()
      .prepare(
        `SELECT d.id AS id, d.source AS source, d.title AS title, d.body AS body, bm25(docs_fts) AS score
         FROM docs_fts JOIN docs d ON d.id = docs_fts.doc_id
         WHERE docs_fts MATCH ? ORDER BY score ASC LIMIT ?`,
      )
      .all(match, limit) as { id: number; source: string; title: string; body: string; score: number }[];
    return rows.map((r) => ({
      id: r.id,
      source: r.source ?? "",
      title: r.title ?? "",
      snippet: snippet(r.body, query),
      score: -r.score, // bm25 is negative (lower better); flip so higher = better
    }));
  } catch {
    return [];
  }
}

async function vectorSearch(query: string, limit: number): Promise<{ id: number; source: string; title: string; snippet: string; score: number }[]> {
  const d = getDb();
  const mode = await initEmbedder();
  if (!mode) {
    // TF-IDF fallback: compare against docs sharing a term with the query.
    const idf = buildIdf();
    if (idf.size === 0) return [];
    const qv = tfidfVector(query, idf);
    const terms = tokenize(query).filter((t) => idf.has(t));
    if (terms.length === 0) return [];
    const like = terms.map((t) => `body LIKE '%${t}%'`).join(" OR ");
    const rows = d.prepare(`SELECT id, source, title, body FROM docs WHERE ${like} LIMIT 500`).all() as {
      id: number;
      source: string;
      title: string;
      body: string;
    }[];
    const scored = rows
      .map((r) => {
        const v = tfidfVector(r.body, idf);
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += qv[i] * v[i];
        return { id: r.id, source: r.source, title: r.title, body: r.body, score: dot };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map((r) => ({ id: r.id, source: r.source, title: r.title, snippet: snippet(r.body, query), score: r.score }));
  }

  // Local mode: cosine over persisted embeddings.
  const qv = (await embedChunks([query])).vectors[0];
  const rows = d.prepare("SELECT doc_id AS docId, dim AS dim, vector AS vector FROM embeddings").all() as {
    docId: number;
    dim: number;
    vector: Uint8Array;
  }[];
  const scored: { id: number; score: number }[] = [];
  for (const r of rows) {
    const bytes = new Uint8Array(r.vector);
    const v = new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
    const dim = Math.min(qv.length, v.length, Number(r.dim) || v.length);
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += qv[i] * v[i];
    scored.push({ id: r.docId, score: dot });
  }
  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  if (top.length === 0) return [];
  const ids = top.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const docs = d.prepare(`SELECT id, source, title, body FROM docs WHERE id IN (${placeholders})`).all(...ids) as {
    id: number;
    source: string;
    title: string;
    body: string;
  }[];
  const byId = new Map(docs.map((x) => [x.id, x]));
  return top
    .map((t) => {
      const doc = byId.get(t.id);
      if (!doc) return null;
      return { id: doc.id, source: doc.source, title: doc.title, snippet: snippet(doc.body, query), score: t.score };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

async function hybridSearch(query: string, limit: number): Promise<unknown[]> {
  const fts = ftsSearch(query, limit * 2);
  const vec = await vectorSearch(query, limit * 2);
  const combined = new Map<number, { id: number; source: string; title: string; snippet: string; score: number; engines: string[] }>();
  const push = (r: { id: number; source: string; title: string; snippet: string; score: number }, engine: string): void => {
    const cur = combined.get(r.id);
    if (cur) {
      cur.engines.push(engine);
      cur.score = Math.max(cur.score, r.score);
    } else {
      combined.set(r.id, { ...r, engines: [engine] });
    }
  };
  for (const r of fts) push(r, "fts");
  for (const r of vec) push(r, "vector");
  return [...combined.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ id, source, title, snippet: sn, score, engines }) => ({ id, source, title, snippet: sn, score: round(score), engines }));
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Crawl a directory and index supported text files (chunked). */
async function indexDirectory(dir: string, limit: number): Promise<{ files: number; chunks: number }> {
  const EXT = new Set([
    ".txt", ".md", ".markdown", ".json", ".yml", ".yaml", ".csv", ".log",
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".py", ".go", ".rs", ".java",
    ".rb", ".sh", ".html", ".css", ".sql", ".toml", ".ini", ".xml",
  ]);
  const MAX_FILE_BYTES = 1_000_000;
  let files = 0;
  let chunks = 0;
  const walk = async (current: string): Promise<void> => {
    if (files >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= limit) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "data") continue;
      const full = path.join(current, entry.name);        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && EXT.has(path.extname(entry.name).toLowerCase())) {
        let content: string;
        try {
          const stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) continue;
          content = fs.readFileSync(full, "utf-8");
          if (content.includes("\u0000")) continue; // binary
        } catch {
          continue;
        }
        const rel = path.relative(dir, full);
        const n = await indexText(content, rel, entry.name);
        if (n > 0) {
          files++;
          chunks += n;
        }
      }
    }
  };
  await walk(dir);
  return { files, chunks };
}

/* ---- tools ---- */

export const knowledgeDefs: ToolDef[] = [
  {
    name: "knowledge_index",
    description:
      "Add a document (text) to the knowledge base. It is chunked, indexed for full-text search (BM25), and embedded for semantic vector search.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The document text to index" },
        title: { type: "string", description: "A short title" },
        source: { type: "string", description: "Where it came from (e.g. a URL or file path)" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const chunks = await indexText(str(args.text), str(args.source, "manual"), str(args.title, "untitled"));
      return textResult(`Indexed ${chunks} chunk${chunks === 1 ? "" : "s"}.`);
    },
  },
  {
    name: "knowledge_search",
    description:
      "Hybrid search over the knowledge base: combines full-text (BM25) and semantic vector search, ranked together.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results (default 10)" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const results = await hybridSearch(str(args.query), Math.min(Math.max(num(args.limit, 10), 1), 50));
      if (results.length === 0) return textResult("No matches found. Index documents first with knowledge_index or knowledge_index_workspace.");
      return jsonResult(results);
    },
  },
  {
    name: "knowledge_fts_search",
    description: "Pure full-text keyword search (SQLite FTS5, BM25 ranking) over the knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
    handler: (args) => {
      const results = ftsSearch(str(args.query), Math.min(Math.max(num(args.limit, 10), 1), 50));
      return results.length === 0 ? textResult("No matches found.") : jsonResult(results);
    },
  },
  {
    name: "knowledge_vector_search",
    description:
      "Semantic vector search over the knowledge base (embeddings; uses local model, TF-IDF fallback if unavailable).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const results = await vectorSearch(str(args.query), Math.min(Math.max(num(args.limit, 10), 1), 50));
      if (results.length === 0) return textResult("No matches found.");
      return jsonResult(results);
    },
  },
  {
    name: "knowledge_index_workspace",
    description:
      "Crawl a directory (default: the first filesystem root) and index all supported text/code files into the knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to crawl; defaults to the first FILESYSTEM_ROOTS entry" },
        max_files: { type: "integer", minimum: 1, maximum: 10000, description: "Cap on files indexed (default 2000)" },
      },
    },
    handler: async (args) => {
      const dir = resolveInside(str(args.path));
      const { files, chunks } = await indexDirectory(dir, Math.min(Math.max(num(args.max_files, 2000), 1), 10000));
      return textResult(`Indexed ${files} file${files === 1 ? "" : "s"} (${chunks} chunk${chunks === 1 ? "" : "s"}) from ${dir}`);
    },
  },
  {
    name: "knowledge_status",
    description: "Knowledge base stats: document/chunk counts, embedding mode, search engines available.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const d = getDb();
      const docs = (d.prepare("SELECT COUNT(*) AS c FROM docs").get() as { c: number }).c;
      const emb = (d.prepare("SELECT COUNT(*) AS c FROM embeddings").get() as { c: number }).c;
      if (embedMode === "pending") void initEmbedder().catch(() => {});
      return jsonResult({
        documents: docs,
        embedded_chunks: emb,
        full_text_search: ftsAvailable ? "fts5 + bm25" : "unavailable",
        embeddings: embedMode,
        model: embedMode === "local" ? EMBED_MODEL : embedMode === "tfidf" ? "tf-idf fallback" : "not loaded yet",
        db: DB_PATH,
      });
    },
  },
  {
    name: "knowledge_clear",
    description: "Delete everything from the knowledge base (documents, embeddings, full-text index).",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const d = getDb();
      if (ftsAvailable) d.exec("DELETE FROM docs_fts");
      d.exec("DELETE FROM embeddings");
      d.exec("DELETE FROM docs");
      return textResult("Knowledge base cleared.");
    },
  },
];

export const knowledgeEnabled = { enabled: true as const };
