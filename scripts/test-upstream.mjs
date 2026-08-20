import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
const s = new McpServer({ name: "tu", version: "1" }, { capabilities: { tools: {} } });
s.registerTool("echo", { description: "echo", inputSchema: fromJsonSchema({ type: "object", properties: { text: { type: "string" } }, required: ["text"] }) }, (a) => ({ content: [{ type: "text", text: `echo:${a.text}` }] }));
s.registerTool("secret", { description: "read secret", inputSchema: fromJsonSchema({ type: "object", properties: {} }) }, () => ({ content: [{ type: "text", text: process.env.MY_SECRET ?? "none" }] }));
await s.connect(new StdioServerTransport());
