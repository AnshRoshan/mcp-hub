import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { num, str } from "../utils.js";

/**
 * Devkit module — deterministic developer utilities, no network, no keys.
 * Regex testing, line diffing, cron parsing, JSON querying, contrast checks.
 */

/* ---------------- regex ---------------- */

const MAX_SAMPLE = 50_000;
const MAX_MATCHES = 100;

/* ---------------- diff ---------------- */

const MAX_DIFF_LINES = 2_000;

interface DiffResult {
  added: number;
  removed: number;
  unchanged: number;
  patch: string;
}

function lineDiff(before: string, after: string): DiffResult {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    throw new Error(`Diff is limited to ${MAX_DIFF_LINES} lines per side (got ${a.length} and ${b.length})`);
  }
  // Classic LCS table, then a backward walk emitting a unified-style patch.
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: { kind: " " | "-" | "+"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "-", line: a[i++] });
    } else {
      ops.push({ kind: "+", line: b[j++] });
    }
  }
  while (i < m) ops.push({ kind: "-", line: a[i++] });
  while (j < n) ops.push({ kind: "+", line: b[j++] });

  const added = ops.filter((o) => o.kind === "+").length;
  const removed = ops.filter((o) => o.kind === "-").length;
  const patch = ops.map((o) => `${o.kind}${o.line}`).join("\n");
  return { added, removed, unchanged: ops.length - added - removed, patch };
}

/* ---------------- cron ---------------- */

interface CronField {
  min: number;
  max: number;
  values: Set<number>;
}

function parseCronField(token: string, min: number, max: number, label: string): CronField {
  const values = new Set<number>();
  for (const part of token.split(",")) {
    if (!part) throw new Error(`Empty entry in cron ${label} field "${token}"`);
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : num(stepPart, NaN);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step "${stepPart}" in cron ${label} field`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [s, e] = rangePart.split("-");
        lo = num(s, NaN);
        hi = num(e, NaN);
      } else {
        lo = hi = num(rangePart, NaN);
        if (stepPart !== undefined) hi = max; // "5/10" means from 5 stepping by 10
      }
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Cron ${label} field "${part}" is out of range ${min}-${max}`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { min, max, values };
}

function describeCronField(f: CronField, label: string): string {
  const size = f.values.size;
  if (size === f.max - f.min + 1) return `every ${label}`;
  if (size === 1) return `${label} = ${[...f.values][0]}`;
  const sorted = [...f.values].sort((x, y) => x - y);
  const step = sorted.length > 1 ? sorted[1] - sorted[0] : 0;
  const even = step > 0 && sorted.every((v, idx) => idx === 0 || v - sorted[idx - 1] === step);
  if (even && sorted[0] === f.min) return `every ${step} ${label}s`;
  if (even && step > 0) return `every ${step} ${label}s from ${sorted[0]}`;
  return `${label} in {${sorted.join(", ")}}`;
}

interface CronSpec {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
}

function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5 cron fields (minute hour day month weekday), got ${fields.length} in "${expression}"`);
  }
  return {
    minute: parseCronField(fields[0], 0, 59, "minute"),
    hour: parseCronField(fields[1], 0, 23, "hour"),
    day: parseCronField(fields[2], 1, 31, "day of month"),
    month: parseCronField(fields[3], 1, 12, "month"),
    weekday: parseCronField(fields[4].replace(/7/g, "0"), 0, 6, "weekday"),
  };
}

function nextCronRuns(spec: CronSpec, from: Date, count: number): Date[] {
  const runs: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = from.getTime() + 400 * 86_400_000;
  while (runs.length < count && cursor.getTime() < limit) {
    if (
      spec.month.values.has(cursor.getUTCMonth() + 1) &&
      spec.day.values.has(cursor.getUTCDate()) &&
      spec.weekday.values.has(cursor.getUTCDay()) &&
      spec.hour.values.has(cursor.getUTCHours()) &&
      spec.minute.values.has(cursor.getUTCMinutes())
    ) {
      runs.push(new Date(cursor.getTime()));
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return runs;
}

/* ---------------- json ---------------- */

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function parsePath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const normalized = path.startsWith("$") ? path.slice(1) : `.${path}`;
  const re = /\.([^.[\]]+)|\[(\d+)\]|\['([^']+)'|\["([^"]+)"\]/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(normalized))) {
    if (match.index !== consumed) {
      throw new Error(`Cannot parse path segment at "${normalized.slice(consumed, match.index)}"`);
    }
    consumed = match.index + match[0].length;
    if (match[1] !== undefined) tokens.push(match[1]);
    else if (match[2] !== undefined) tokens.push(Number(match[2]));
    else tokens.push(match[3] ?? match[4] ?? "");
  }
  if (consumed !== normalized.length) {
    throw new Error(`Cannot parse path "${path}" — use forms like a.b[2].c or $['a-b']`);
  }
  return tokens;
}

function followPath(root: JsonValue, tokens: (string | number)[]): JsonValue {
  let cur = root;
  for (const t of tokens) {
    if (Array.isArray(cur) && typeof t === "number") {
      if (t >= cur.length) throw new Error(`Index [${t}] is out of range (array has ${cur.length} items)`);
      cur = cur[t];
    } else if (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
      if (!(String(t) in cur)) throw new Error(`Key "${String(t)}" not found (available: ${Object.keys(cur).slice(0, 20).join(", ")})`);
      cur = (cur as Record<string, JsonValue>)[String(t)];
    } else {
      throw new Error(`Cannot read "${String(t)}" from a ${cur === null ? "null" : typeof cur}`);
    }
  }
  return cur;
}

function shapeOf(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "object") return `object(${Object.keys(v).length} keys)`;
  return typeof v;
}

/* ---------------- contrast ---------------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`"${hex}" is not a #rgb or #rrggbb hex color`);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/* ---------------- tool definitions ---------------- */

export const devkitDefs: ToolDef[] = [
  {
    name: "regex_test",
    description:
      "Test a JavaScript regex against sample text. Returns every match with its position, capture groups, and named groups, plus a match count.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex source, without surrounding slashes" },
        sample: { type: "string", description: "Text to run the regex against" },
        flags: { type: "string", description: "Flags like i or im; g is added automatically for enumeration" },
      },
      required: ["pattern", "sample"],
    },
    handler: (args) => {
      const pattern = str(args.pattern);
      const sample = str(args.sample).slice(0, MAX_SAMPLE);
      const flags = (str(args.flags, "") + "g").split("").filter((c, i, a) => "gimsuyd".includes(c) && a.indexOf(c) === i).join("");
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch (err) {
        return jsonResult({ valid: false, error: err instanceof Error ? err.message : String(err) });
      }
      const matches: { text: string; index: number; groups: (string | null)[]; named: Record<string, string> }[] = [];
      for (const m of sample.matchAll(re)) {
        matches.push({
          text: m[0],
          index: m.index ?? 0,
          groups: m.slice(1).map((g) => g ?? null),
          named: { ...(m.groups ?? {}) },
        });
        if (matches.length >= MAX_MATCHES) break;
      }
      return jsonResult({ valid: true, pattern, flags, matchCount: matches.length, truncated: matches.length >= MAX_MATCHES, matches });
    },
  },
  {
    name: "text_diff",
    description:
      "Compare two blocks of text line by line. Returns a unified patch with +/- prefixes plus counts of added, removed, and unchanged lines.",
    inputSchema: {
      type: "object",
      properties: {
        before: { type: "string", description: "The original text" },
        after: { type: "string", description: "The changed text" },
      },
      required: ["before", "after"],
    },
    handler: (args) => jsonResult(lineDiff(str(args.before), str(args.after))),
  },
  {
    name: "cron_parse",
    description:
      "Explain a 5-field crontab expression and compute its next run times. Returns a human-readable schedule and upcoming UTC timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: 'Cron expression like "0 9 * * 1-5"' },
        from: { type: "string", description: "ISO start time to search from (default: now)" },
        count: { type: "integer", minimum: 1, maximum: 20, description: "How many upcoming runs to list (default 5)" },
      },
      required: ["expression"],
    },
    handler: (args) => {
      const expression = str(args.expression);
      const spec = parseCron(expression);
      const from = str(args.from) ? new Date(str(args.from)) : new Date();
      if (Number.isNaN(from.getTime())) throw new Error(`"${str(args.from)}" is not a valid ISO date`);
      const count = Math.min(Math.max(num(args.count, 5), 1), 20);
      const runs = nextCronRuns(spec, from, count);
      return jsonResult({
        expression,
        explain: [
          describeCronField(spec.minute, "minute"),
          describeCronField(spec.hour, "hour"),
          describeCronField(spec.day, "day"),
          describeCronField(spec.month, "month"),
          describeCronField(spec.weekday, "weekday"),
        ].join(" · "),
        timezone: "UTC",
        nextRuns: runs.map((d) => d.toISOString()),
      });
    },
  },
  {
    name: "json_query",
    description:
      "Validate a JSON document and extract a value by path (like data.items[2].name). Returns the extracted value, its shape, and top-level keys.",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "The raw JSON document" },
        path: { type: "string", description: "Dot/bracket path to extract; omit to just validate and summarize" },
      },
      required: ["json"],
    },
    handler: (args) => {
      const raw = str(args.json);
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(raw) as JsonValue;
      } catch (err) {
        return jsonResult({ valid: false, error: err instanceof Error ? err.message : String(err) });
      }
      const path = str(args.path);
      const summary: Record<string, unknown> = {
        valid: true,
        shape: shapeOf(parsed),
        topLevelKeys: parsed !== null && typeof parsed === "object" ? Object.keys(parsed).slice(0, 50) : [],
      };
      if (path && path !== "$") {
        const value = followPath(parsed, parsePath(path));
        summary.value = value;
        summary.valueShape = shapeOf(value);
      }
      return jsonResult(summary);
    },
  },
  {
    name: "color_contrast",
    description:
      "Check the WCAG 2.1 contrast ratio between two hex colors. Returns the ratio and pass/fail verdicts for AA and AAA text sizes.",
    inputSchema: {
      type: "object",
      properties: {
        foreground: { type: "string", description: "Text color as #rgb or #rrggbb" },
        background: { type: "string", description: "Background color as #rgb or #rrggbb" },
      },
      required: ["foreground", "background"],
    },
    handler: (args) => {
      const l1 = relativeLuminance(hexToRgb(str(args.foreground)));
      const l2 = relativeLuminance(hexToRgb(str(args.background)));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const r = Math.round(ratio * 100) / 100;
      return jsonResult({
        ratio: r,
        aaNormal: r >= 4.5,
        aaLarge: r >= 3,
        aaaNormal: r >= 7,
        aaaLarge: r >= 4.5,
      });
    },
  },
];
