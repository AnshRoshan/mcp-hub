import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
const s = new McpServer({ name: "tu", version: "1" }, { capabilities: { tools: {} } });
s.registerTool("echo", { description: "echo", title: "Echo Tool", _meta: { "io.modelcontextprotocol/ui": { resourceUri: "ui://demo/echo" }, vendor: "tu" }, inputSchema: fromJsonSchema({ type: "object", properties: { text: { type: "string" } }, required: ["text"] }) }, (a) => ({ content: [{ type: "text", text: `echo:${a.text}` }] }));
s.registerTool("secret", { description: "read secret", inputSchema: fromJsonSchema({ type: "object", properties: {} }) }, () => ({ content: [{ type: "text", text: process.env.MY_SECRET ?? "none" }] }));
s.registerResource("echo-ui", "ui://demo/echo", { title: "Echo UI", mimeType: "text/html" }, () => ({ contents: [{ uri: "ui://demo/echo", mimeType: "text/html", text: "<h1>echo widget</h1>" }] }));
s.registerResource("readme", "note://tu/readme", { description: "fixture readme", mimeType: "text/plain" }, () => ({ contents: [{ uri: "note://tu/readme", mimeType: "text/plain", text: "fixture upstream readme" }] }));
await s.connect(new StdioServerTransport());
