import { type CSSProperties, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ArrowRight } from "lucide-react";
import { MODULES } from "../lib/catalog";
import { useStore } from "../lib/store";
import { Badge, CopyBtn } from "../components/ui";

export default function Dashboard() {
  const { status, servers, tokens, me, navigate } = useStore();
  const s = status || {};
  const modules = (s.modules || []).filter((m) => MODULES[m.name]);
  const disabled = new Set(me?.disabledModules || []);
  const yourTools = modules.reduce((n, m) => (m.enabled && !disabled.has(m.name) ? n + (m.toolCount || 0) : n), 0);
  const activeServers = servers.filter((sv) => sv.enabled).length;
  const modulesOn = modules.filter((m) => m.enabled && !disabled.has(m.name)).length;
  const cards = modules.length - modulesOn;

  const done1 = servers.length > 0;
  const done2 = tokens.length > 0;

  return (
    <div className="flex flex-col gap-7">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Workstation Status</Heading>
          <Text type="supporting" className="mt-1">
            Live view of the systems exposed through your MCP endpoint.
          </Text>
        </div>
        <Button label="Connect guide" variant="primary" icon={<ArrowRight size={15} />} onClick={() => navigate("connect")} />
      </div>

      <section className="metrics-rail" aria-label="Endpoint telemetry">
        <Tile label="Tools" value={yourTools || s.totalTools || 0} unit="exposed" lit={pct(yourTools, 60)} />
        <Tile label="Servers" value={activeServers} unit={`of ${servers.length} linked`} lit={pct(activeServers, Math.max(servers.length, 1))} tone={activeServers || servers.length === 0 ? "go" : "caution"} />
        <Tile label="Tokens" value={tokens.length} unit="live" lit={pct(tokens.length, 6)} />
        <Tile label="Modules" value={modulesOn} unit={cards ? `${cards} on card` : "all go"} lit={pct(modulesOn, modules.length || 1)} tone={cards ? "mixed" : "go"} />
      </section>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,2.1fr)_minmax(320px,0.9fr)]">
        <section>
          <div className="section-heading mb-3">
            <Heading level={4} className="!mb-0">Systems Status Wall</Heading>
            <span className="section-count">{modulesOn} / {modules.length}</span>
            <Button label="Manage" variant="ghost" size="sm" className="ml-1" onClick={() => navigate("modules")} />
          </div>
          {modules.length === 0 ? (
            <div className="module-summary">
              <div className="module-summary-row text-secondary">No module data yet — start the server to bring the wall live.</div>
            </div>
          ) : (
            <div className="module-summary">
              <div className="module-summary-row wall-head">
                <span>System</span>
                <span>Tools</span>
                <span style={{ textAlign: "right" }}>Flag</span>
              </div>
              {modules.map((m) => {
                const userOff = disabled.has(m.name);
                const go = m.enabled && !userOff;
                const flag = go ? "GO" : m.enabled ? "OFF" : "CARD";
                const note = go
                  ? `${m.toolCount || 0} tools ready`
                  : m.enabled ? "you switched it off"
                  : m.reason || "needs setup";
                return (
                  <div key={m.name} className={`module-summary-row ${go ? "" : "row-dim"}`}>
                    <div className="min-w-0">
                      <span className="truncate text-primary font-medium">{m.name}</span>
                      {m.category && <span className="ml-2 text-tertiary text-[11px] uppercase tracking-[0.1em]">{m.category}</span>}
                    </div>
                    <span className="telemetry text-xs text-secondary">{go ? m.toolCount || 0 : "—"}</span>
                    <span style={{ textAlign: "right" }}>
                      <Badge tone={go ? "ok" : m.enabled ? "off" : "warn"}>{flag}</Badge>
                    </span>
                    <span className="leader-note">{note}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-6 border-l border-border pl-5 xl:pl-7">
          <div>
            <Heading level={4}>Your endpoint</Heading>
            <div className="endpoint-plate mt-3">
              <span className="uplink-led" aria-hidden />
              <code title="MCP endpoint URL">{`${window.location.origin}/mcp`}</code>
              <CopyBtn text={`${window.location.origin}/mcp`} label="" />
            </div>
          </div>
          <div>
            <Heading level={4}>Pre-Flight</Heading>
            <Text type="supporting" size="sm" className="mt-1.5 leading-relaxed">
              Complete once, then every capability is available from one connection.
            </Text>
            <ol className="mt-5 quick-steps">
              <Step n={1} done={done1} text="Add an MCP server" action={<Button label="Servers" variant="ghost" size="sm" onClick={() => navigate("servers")} />} />
              <Step n={2} done={done2} text="Create an API token" action={<Button label="Tokens" variant="ghost" size="sm" onClick={() => navigate("tokens")} />} />
              <Step n={3} done={done1 && done2} text={<>Point your client at <code>/mcp</code></>} />
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(12, Math.round((value / max) * 12)));
}

/** Telemetry tile: engraved label, mono value, LED ladder of real load. */
function Tile({ label, value, unit, lit, tone = "telemetry" }: {
  label: string; value: number; unit: string; lit: number; tone?: "go" | "caution" | "mixed" | "telemetry";
}) {
  const color =
    tone === "go" ? "var(--fd-go)" : tone === "caution" ? "var(--fd-caution)" :
    tone === "mixed" ? "var(--fd-caution)" : "var(--fd-telemetry)";
  return (
    <div className="power-on">
      <Text type="label" size="sm" className="text-secondary">{label}</Text>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="telemetry text-[34px] font-bold leading-none text-primary">{value}</span>
        <span className="telemetry text-[10.5px] uppercase tracking-[0.1em] text-tertiary">{unit}</span>
      </div>
      <div className="led-ladder" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={`led ${i < lit ? "on" : ""}`} style={{ "--led-color": color } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

function Step({ n, text, action, done }: { n: number; text: ReactNode; action?: ReactNode; done?: boolean }) {
  return (
    <li className="quick-step">
      <span className={`telemetry flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[4px] border text-[11px] font-bold ${done ? "flag-go" : "border-border text-secondary"}`}>
        {n}
      </span>
      <span className="min-w-0 flex-1 text-sm text-secondary">{text}</span>
      {action}
    </li>
  );
}
