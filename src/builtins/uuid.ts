import { randomUUID } from "node:crypto";
import type { ToolDef } from "../registry.js";
import { textResult } from "../result.js";
import { num } from "../utils.js";

export const uuidDefs: ToolDef[] = [
  {
    name: "uuid_generate",
    description: "Generate one or more random (v4) UUIDs.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: 100, description: "How many UUIDs to generate (default 1)" },
      },
    },
    handler: (args) => {
      const count = Math.min(Math.max(num(args.count, 1), 1), 100);
      const ids = Array.from({ length: count }, () => randomUUID());
      return textResult(ids.join("\n"));
    },
  },
];
