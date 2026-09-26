import { useState } from "react";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Heading, Text } from "@astryxdesign/core/Text";
import { CLIENTS } from "../lib/catalog";
import { mcpEndpoint } from "../lib/config";
import { useStore } from "../lib/store";
import { Btn, Kv, KvList, TabRail } from "../components/ui";

export default function Connect() {
  const { navigate } = useStore();
  const [active, setActive] = useState<string>(CLIENTS[0].id);
  const mcp = mcpEndpoint();
  const client = CLIENTS.find((c) => c.id === active) || CLIENTS[0];
  const cfg = client.build(mcp);
  const isCmd = client.kind === "cmd";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Heading level={2}>Connect</Heading>
        <Text type="supporting" className="mt-1 max-w-[72ch]">
          Every client points at <code>/mcp</code> with the same Bearer token.
        </Text>
      </div>

      <div className="grid grid-cols-1 items-start gap-4.5 xl:grid-cols-[340px_1fr]">
        <section className="panel">
          <Heading level={4}>Quick start</Heading>
          <ol className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            <Step n={1}>
              <Text weight="semibold">Add servers</Text>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <Btn variant="link" onClick={() => navigate("servers")}>Servers</Btn>
                <Btn variant="link" onClick={() => navigate("modules")}>Modules</Btn>
              </div>
            </Step>
            <Step n={2}>
              <Text weight="semibold">Create a token</Text>
              <div className="mt-1.5">
                <Btn variant="link" onClick={() => navigate("tokens")}>Tokens</Btn>
              </div>
            </Step>
            <Step n={3}>
              <Text weight="semibold">
                Point at <code>/mcp</code>
              </Text>
            </Step>
          </ol>

          <div className="mt-5 rounded-[4px] border border-border bg-surface p-3">
            <Text type="supporting" size="sm">
              <strong className="telemetry text-primary">stdio</strong> runs locally · <strong className="telemetry text-primary">HTTP</strong> points at a remote endpoint
            </Text>
          </div>
        </section>

        <section className="panel">
          <TabRail items={CLIENTS.map((c) => ({ id: c.id, label: c.name }))} value={active} onChange={setActive} />

          <div key={client.id} className="mt-4">
            <div className="mb-4">
              <KvList>
                <Kv k="Endpoint URL" v={mcp} mono />
                <Kv k="Auth" v="Authorization: Bearer <your-api-token>" />
              </KvList>
            </div>

            <CodeBlock code={cfg} language={isCmd ? "bash" : "json"} title={client.file} hasLanguageLabel={false} maxHeight={320} />

            <Text type="supporting" size="sm" className="mt-3">
              No token yet?{" "}
              <Btn variant="link" onClick={() => navigate("tokens")}>Create one</Btn>.
            </Text>
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="telemetry flex h-7 w-7 flex-none items-center justify-center rounded-[4px] border border-border bg-surface text-[11px] font-bold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </li>
  );
}
