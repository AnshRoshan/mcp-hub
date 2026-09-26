import type { ToolDef } from "../registry.js";
import { textResult } from "../result.js";
import { str } from "../utils.js";

function formatInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function requireTz(timezone: string): string {
  if (!validTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: "${timezone}"`);
  }
  return timezone;
}

/** Minutes ahead of UTC that `timezone`'s wall clock reads at instant `at`. */
function tzOffsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock reading with no zone and no UTC offset. Captured rather than fed
 * to `new Date`, because that would resolve it against the *host's* zone and
 * make a server's answers depend on where it happens to run.
 */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

export const timeDefs: ToolDef[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time, optionally in a specific IANA timezone (e.g. Asia/Kolkata, America/New_York).",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA timezone name; defaults to the server's local timezone" },
      },
    },
    handler: (args) => {
      const now = new Date();
      const tz = str(args.timezone);
      const output = tz
        ? `${formatInTz(now, requireTz(tz))} (${tz})`
        : now.toISOString() + " (UTC)";
      return textResult(output);
    },
  },
  {
    name: "convert_timezone",
    description: "Convert a timestamp from one IANA timezone to another.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: "Timestamp (ISO 8601 or any Date-parsable string)" },
        from_timezone: { type: "string", description: "IANA timezone the input is in (defaults to UTC)" },
        to_timezone: { type: "string", description: "IANA timezone to convert to (required)" },
      },
      required: ["time", "to_timezone"],
    },
    handler: (args) => {
      const time = str(args.time).trim();
      const to = requireTz(str(args.to_timezone));
      const from = requireTz(str(args.from_timezone) || "UTC");
      const wall = WALL_CLOCK.exec(time);
      if (wall === null) {
        const absolute = new Date(time);
        if (Number.isNaN(absolute.getTime())) throw new Error(`Could not parse time: "${time}"`);
        // The input pins its own instant, so from_timezone has nothing to say.
        const suffix = from === "UTC" ? "" : " (input carried its own offset; from_timezone ignored)";
        return textResult(`${formatInTz(absolute, to)} (${to})${suffix}`);
      }
      const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = wall;
      const asUtc = Date.UTC(
        Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s),
        Number(frac.padEnd(3, "0").slice(0, 3)),
      );
      // Resolve the offset twice: a DST boundary between the naive reading and
      // the true instant would otherwise leave the result an hour out.
      const first = tzOffsetMinutes(from, new Date(asUtc));
      const candidate = new Date(asUtc - first * 60_000);
      const second = tzOffsetMinutes(from, candidate);
      const instant = second === first ? candidate : new Date(asUtc - second * 60_000);
      const iso = instant.toISOString().replace("T", " ").slice(0, 19);
      return textResult(`${formatInTz(instant, to)} (${to}) — ${time} as ${from} wall time (= ${iso} UTC)`);
    },
  },
];
