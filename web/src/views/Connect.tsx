import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { CLIENTS } from "../lib/catalog";
import { mcpEndpoint } from "../lib/config";
import { useStore } from "../lib/store";
import { Kv, KvList } from "../components/ui";

export default function Connect() {
  const { navigate } = useStore();
  const [active, setActive] = useState(CLIENTS[0].id);
  const mcp = mcpEndpoint();
  const client = CLIENTS.find((c) => c.id === active) || CLIENTS[0];
  const cfg = client.build(mcp);
  const isCmd = client.kind === "cmd";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Heading level={2}>Connect</Heading>
        <Text type="supporting" className="mt-1 max-w-[72ch]">
          Every client points at <code>/mcp</code> with the same Bearer token. Pick yours below.
        </Text>
      </div>

      <div className="grid grid-cols-1 items-start gap-4.5 xl:grid-cols-[340px_1fr]">
        <Card padding={5}>
          <Heading level={4}>How it works</Heading>
          <ol className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
            <Step n={1}>
              <Text weight="semibold">Add servers</Text>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Button label="Servers" variant="ghost" size="sm" onClick={() => navigate("servers")} />
                <Button label="Modules" variant="ghost" size="sm" onClick={() => navigate("modules")} />
              </div>
            </Step>
            <Step n={2}>
              <Text weight="semibold">Create a token</Text>
              <div className="mt-1">
                <Button label="API Tokens" variant="ghost" size="sm" onClick={() => navigate("tokens")} />
              </div>
            </Step>
            <Step n={3}>
              <Text weight="semibold">
                Point at <code>/mcp</code>
              </Text>
            </Step>
          </ol>

          <div className="mt-5 rounded-md border border-dashed border-border bg-muted p-3.5">
            <Text type="supporting" size="sm">
              <strong className="text-primary">stdio</strong> runs locally. <strong className="text-primary">HTTP</strong> points at a remote endpoint.
            </Text>
          </div>
        </Card>

        <Card padding={5}>
          <TabList value={active} onChange={setActive} hasDivider size="sm" layout="fill">
            {CLIENTS.map((c) => (
              <Tab key={c.id} value={c.id} label={c.name} />
            ))}
          </TabList>

          <div key={client.id} className="mt-4">
            <div className="mb-4">
              <KvList>
                <Kv k="Endpoint URL" v={mcp} mono />
                <Kv k="Auth" v="Authorization: Bearer <your-api-token>" />
              </KvList>
            </div>

            <CodeBlock
              code={cfg}
              language={isCmd ? "bash" : "json"}
              title={client.file}
              hasLanguageLabel={false}
              maxHeight={320}
            />

            <Text type="supporting" size="sm" className="mt-3">
              No token yet?{" "}
              <Button label="Create one in API Tokens" variant="ghost" size="sm" onClick={() => navigate("tokens")} />
              . Then verify the connection — most clients show an MCP status panel.
            </Text>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </li>
  );
}
