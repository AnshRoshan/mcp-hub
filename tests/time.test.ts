import { test } from "node:test";
import assert from "node:assert/strict";
import { timeDefs } from "../src/builtins/time.js";

const convert = timeDefs.find((d) => d.name === "convert_timezone")!;
const text = (args: Record<string, unknown>): string => {
  const result = convert.handler(args) as { content: { text: string }[] };
  return result.content[0].text;
};
const utcOf = (time: string, from?: string): string =>
  text({ time, to_timezone: "UTC", ...(from ? { from_timezone: from } : {}) }).match(/= (.+?) UTC/)![1];

test("a wall-clock reading is resolved in the zone it was taken in", () => {
  assert.equal(utcOf("2026-06-15T12:00:00", "Asia/Kolkata"), "2026-06-15 06:30:00");
  assert.equal(utcOf("2026-01-15T12:00:00", "America/New_York"), "2026-01-15 17:00:00");
});

test("the zone's DST state at that instant decides the offset", () => {
  assert.equal(utcOf("2026-01-15T12:00:00", "America/New_York"), "2026-01-15 17:00:00", "EST is UTC-5");
  assert.equal(utcOf("2026-07-15T12:00:00", "America/New_York"), "2026-07-15 16:00:00", "EDT is UTC-4");
});

test("date-only input means local midnight, not UTC midnight", () => {
  assert.equal(utcOf("2026-06-15", "Asia/Kolkata"), "2026-06-14 18:30:00");
});

test("an input carrying its own offset is an instant and ignores from_timezone", () => {
  const out = text({ time: "2026-06-15T12:00:00Z", from_timezone: "Asia/Kolkata", to_timezone: "UTC" });
  assert.match(out, /^2026-06-15, 12:00:00 \(UTC\)/);
  assert.match(out, /from_timezone ignored/);
});

test("omitting from_timezone keeps treating the reading as UTC", () => {
  assert.equal(utcOf("2026-06-15T12:00:00"), "2026-06-15 12:00:00");
});

test("bad zones and unparseable times throw instead of guessing", () => {
  assert.throws(() => text({ time: "2026-01-01", from_timezone: "Mars/Olympus", to_timezone: "UTC" }), /Invalid IANA timezone/);
  assert.throws(() => text({ time: "2026-01-01", to_timezone: "Not/AZone" }), /Invalid IANA timezone/);
  assert.throws(() => text({ time: "sometime Tuesday", to_timezone: "UTC" }), /Could not parse time/);
});
