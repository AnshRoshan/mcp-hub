import { type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ArrowRight, Cable, KeyRound, Server, Wrench } from "lucide-react";
import { MODULES } from "../lib/catalog";
import { useStore } from "../lib/store";
import { Badge, Empty } from "../components/ui";

export default function Dashboard() {
  const { status, servers, tokens, me, navigate } = useStore();
  const s = status || {};
  const modules = (s.modules || []).filter((m) => MODULES[m.name]);
  const disabled = new Set(me?.disabledModules || []);
  const yourTools = modules.reduce((n, m) => (m.enabled && !disabled.has(m.name) ? n + (m.toolCount || 0) : n), 0);
  const activeServers = servers.filter((sv) => sv.enabled).length;
  const modulesOn = modules.filter((m) => m.enabled && !disabled.has(m.name)).length;

  return (
    <div className="flex flex-col gap-7">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Workstation</Heading>
          <Text type="supporting" className="mt-1">
            Live view of capabilities exposed through your MCP endpoint.
          </Text>
        </div>
        <Button label="Connect guide" variant="primary" icon={<ArrowRight size={15} />} onClick={() => navigate("connect")} />
      </div>

      <section className="metrics-rail" aria-label="Endpoint overview">
        <Metric icon={<Wrench size={15} />} label="Tools" value={yourTools || s.totalTools || 0} />
        <Metric icon={<Server size={15} />} label="Servers" value={activeServers} />
        <Metric icon={<KeyRound size={15} />} label="Tokens" value={tokens.length} />
        <Metric icon={<Cable size={15} />} label="Modules" value={modulesOn} />
      </section>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
        <section>
          <div className="section-heading mb-3">
            <Heading level={4} className="!mb-0">Modules</Heading>
            <span className="section-count">{modulesOn} / {modules.length}</span>
            <Button label="Manage" variant="ghost" size="sm" className="ml-1" onClick={() => navigate("modules")} />
          </div>
          {modules.length === 0 ? (
            <Empty>No module data yet. Start the server to see modules.</Empty>
          ) : (
            <div className="module-summary">
              <div className="module-summary-row" style={{ fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary)" }}>
                <span>Module</span>
                <span>Tools</span>
                <span style={{ textAlign: "right" }}>Status</span>
              </div>
              {modules.map((m) => {
                const on = m.enabled && !disabled.has(m.name);
                return (
                  <div key={m.name} className={`module-summary-row ${on ? "" : "opacity-60"}`}>
                    <div className="min-w-0">
                      <span className="truncate text-primary font-medium">{m.name}</span>
                      {m.category && <span className="ml-2 text-tertiary text-[11px]">{m.category}</span>}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-secondary">{on ? m.toolCount || 0 : "—"}</span>
                    <span style={{ textAlign: "right" }}>
                      <Badge tone={on ? "ok" : m.enabled ? "off" : "warn"}>{on ? "on" : m.enabled ? "off" : "setup"}</Badge>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="border-l border-border pl-5 xl:pl-7">
          <Heading level={4}>Get started</Heading>
          <Text type="supporting" size="sm" className="mt-1.5 leading-relaxed">
            Complete once, then every capability is available from one connection.
          </Text>
          <ol className="mt-5 quick-steps">
            <QuickStep n={1} text="Add an MCP server" action={<Button label="Servers" variant="ghost" size="sm" onClick={() => navigate("servers")} />} />
            <QuickStep n={2} text="Create an API token" action={<Button label="Tokens" variant="ghost" size="sm" onClick={() => navigate("tokens")} />} />
            <QuickStep n={3} text={<>Point at <code>/mcp</code></>} />
          </ol>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-secondary">
        {icon}
        <Text type="label" size="sm" className="text-secondary">{label}</Text>
      </div>
      <Text size="3xl" weight="bold" className="mt-3 leading-none tabular-nums">{value}</Text>
    </div>
  );
}

function QuickStep({ n, text, action }: { n: number; text: ReactNode; action?: ReactNode }) {
  return (
    <li className="quick-step">
      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-secondary">{n}</span>
      <span className="min-w-0 flex-1 text-sm text-secondary">{text}</span>
      {action}
    </li>
  );
}
