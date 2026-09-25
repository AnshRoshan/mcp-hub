import { test } from "node:test";
import assert from "node:assert/strict";
import {
  env,
  envBool,
  layeredEnv,
  processEnv,
  str,
  num,
  strArr,
  obj,
  assertOk,
  assertReadOnly,
  withTimeout,
  type HttpResponse,
} from "../src/utils.js";

test("env trims values and treats blank as unset", () => {
  process.env.UT_ENV = "  hello  ";
  assert.equal(env("UT_ENV"), "hello");
  process.env.UT_ENV = "   ";
  assert.equal(env("UT_ENV"), undefined);
  assert.equal(env("UT_ENV_UNSET"), undefined);
});

test("envBool accepts truthy spellings and falls back", () => {
  for (const v of ["1", "true", "YES", "On"]) {
    process.env.UT_BOOL = v;
    assert.equal(envBool("UT_BOOL", false), true, v);
  }
  process.env.UT_BOOL = "nope";
  assert.equal(envBool("UT_BOOL", true), false);
  delete process.env.UT_BOOL;
  assert.equal(envBool("UT_BOOL", true), true);
  assert.equal(envBool("UT_BOOL", false), false);
});

test("str/num/strArr/obj coerce unknown args", () => {
  assert.equal(str(undefined), "");
  assert.equal(str(null, "fb"), "fb");
  assert.equal(str(42), "42");

  assert.equal(num("7"), 7);
  assert.equal(num("banana", 5), 5);
  assert.equal(num(Infinity, -1), -1);

  assert.deepEqual(strArr(["a", 2]), ["a", "2"]);
  assert.deepEqual(strArr("nope"), []);

  assert.deepEqual(obj({ a: 1 }), { a: 1 });
  assert.deepEqual(obj([1, 2]), {});
  assert.deepEqual(obj(null), {});
});

test("assertOk passes under 400 and throws readable errors", () => {
  const res = (status: number, body: unknown): HttpResponse => ({
    status,
    statusText: "",
    headers: {},
    body,
  });
  assert.doesNotThrow(() => assertOk(res(200, {}), "GitHub /x"));
  assert.doesNotThrow(() => assertOk(res(399, {}), "GitHub /x"));
  assert.throws(() => assertOk(res(404, { message: "Not Found" }), "GitHub /x"), /GitHub \/x failed \(HTTP 404\): Not Found/);
  assert.throws(() => assertOk(res(500, { error: "boom" }), "Jira /y"), /Jira \/y failed \(HTTP 500\): boom/);
  assert.throws(() => assertOk(res(502, "text"), "Svc /z"), /Svc \/z failed \(HTTP 502\)$/);
});

test("assertReadOnly blocks writes unless allowed", () => {
  const opts = { allowWrite: false, writeRe: /^\s*(insert|update|delete)\b/i, dbName: "testdb", envVar: "TEST_WRITE" };
  assert.doesNotThrow(() => assertReadOnly("SELECT 1", opts));
  assert.throws(() => assertReadOnly("DELETE FROM t", opts), /read-only mode; set TEST_WRITE=true/);
  assert.doesNotThrow(() => assertReadOnly("DELETE FROM t", { ...opts, allowWrite: true }));
});

test("withTimeout resolves, rejects, and propagates", async () => {
  assert.equal(await withTimeout(Promise.resolve("v"), 100, "fast"), "v");
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 50)), 5, "slow"), /slow timed out after 5ms/);
  await assert.rejects(withTimeout(Promise.reject(new Error("inner")), 100, "rej"), /inner/);
});

test("layeredEnv prefers user secrets, falls back to process env", () => {
  process.env.UT_LAYERED = "global-value";
  const layered = layeredEnv({ UT_LAYERED: "mine", UT_ONLY_USER: "u" }, processEnv);
  assert.equal(layered.get("UT_LAYERED"), "mine");
  assert.equal(layered.get("UT_ONLY_USER"), "u");
  assert.equal(layered.get("UT_LAYERED_MISSING"), undefined);
  // Empty-string user entries fall through to the base (blank = unset).
  const blank = layeredEnv({ UT_LAYERED: "" }, processEnv);
  assert.equal(blank.get("UT_LAYERED"), "global-value");
});
