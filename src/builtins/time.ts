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
      const time = str(args.time);
      const to = requireTz(str(args.to_timezone));
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Could not parse time: "${time}"`);
      }
      const from = str(args.from_timezone) || "UTC";
      if (from !== "UTC") requireTz(from);
      return textResult(`${formatInTz(date, to)} (${to})`);
    },
  },
];
