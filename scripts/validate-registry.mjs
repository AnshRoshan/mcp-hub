/**
 * Validates registry/server.json against the vendored official MCP Registry
 * schema (offline, deterministic). Run: npm run validate:registry
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "registry", "server.schema.json"), "utf8"));
const entry = JSON.parse(fs.readFileSync(path.join(ROOT, "registry", "server.json"), "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const ok = validate(entry);
if (!ok) {
  console.error("registry/server.json INVALID:");
  for (const err of validate.errors) console.error("  -", err.instancePath || "(root)", err.message);
  process.exit(1);
}
console.log(`registry/server.json valid (${entry.name} v${entry.version})`);
