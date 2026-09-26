import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ArrowRight, Cable } from "lucide-react";
import { loadUsage, type UsageSummary } from "../lib/api";
import { mcpEndpoint } from "../lib/config";
import { useStore } from "../lib/store";
import { Badge, Btn, CopyBtn } from "../components/ui";

interface WallRow {
  name: string;
  category?: string;
  count: number | null;
  flag: string;
  tone: "ok" | "off" | "warn";
  note: string;
}

export default function Dashboard() {
  const { status, statusError, servers, tokens, me, navigate } = useStore();
  const s = status || {};
  // No status means no answer from the workstation — never a wall of all-GO.
  const live = status !== null;
  const disabled = new Set(me?.disabledModules || []);
  const modules = s.modules || [];
  const upstreams = [...(s.upstreams || []), ...(s.userUpstreams || [])];
  const yourTools = modules.reduce((n, m) => (m.enabled && !disabled.has(m.name) ? n + (m.toolCount || 0) : n), 0);
  const activeServers = servers.filter((sv) => sv.enabled).length;
  const modulesOn = modules.filter((m) => m.enabled && !disabled.has(m.name)).length;
  const onCard = modules.length - modulesOn + upstreams.filter((u) => u.state !== "connected").length;

  const wall: WallRow[] = [
    ...modules.map<WallRow>((m) => {
      const userOff = disabled.has(m.name);
      const go = m.enabled && !userOff;
      return {
        name: m.name,
        category: m.category,
        count: go ? m.toolCount || 0 : null,
        flag: go ? "GO" : m.enabled ? "OFF" : "CARD",
        tone: go ? "ok" : m.enabled ? "off" : "warn",
        note: go
          ? `${m.toolCount || 0} tools ready`
          : m.enabled ? "you switched it off"
          : m.reason || "needs setup",
      };
    }),
    ...upstreams.map<WallRow>((u) => ({
      name: u.key,
      category: "Upstream",
      count: u.state === "connected" ? u.toolCount : null,
      flag: u.state === "connected" ? "GO" : "CARD",
      tone: u.state === "connected" ? "ok" : "warn",
      note: u.error || u.detail,
    })),
  ];
  const wallGo = wall.filter((r) => r.tone === "ok").length;

  const endpoint = mcpEndpoint();
  const done1 = servers.length > 0;
  const done2 = tokens.length > 0;
  const done3 = done1 && done2;
  const stepsDone = (done1 ? 1 : 0) + (done2 ? 1 : 0) + (done3 ? 1 : 0);

  return (
    <div className="flex flex-col gap-7">
      <section className="flight-strip" aria-label="MCP endpoint">
        <div className="endpoint-plate">
          <span className={`uplink-led ${status ? "" : "is-down"}`} aria-hidden />
          <div className="min-w-0">
            <div className="telemetry text-[10px] uppercase tracking-[0.16em] text-disabled">Your endpoint</div>
            <code title="MCP endpoint URL">{endpoint}</code>
          </div>
          <CopyBtn text={endpoint} label="" className="ml-auto" />
        </div>
        <Btn variant="primary" icon={<Cable size={13} />} onClick={() => navigate("connect")}>
          Connect a client
        </Btn>
      </section>

      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Workstation Status</Heading>
          <Text type="supporting" className="mt-1">
            Live view of the systems exposed through your MCP endpoint.
          </Text>
        </div>
        <Btn variant="link" icon={<ArrowRight size={13} />} onClick={() => navigate("modules")}>
          Manage systems
        </Btn>
      </div>

      <section className="metrics-rail" aria-label="Endpoint telemetry">
        <Tile label="Tools" value={live ? yourTools || s.totalTools || 0 : null} unit={live ? "exposed" : "unknown"} lit={live ? pct(yourTools, 60) : 0} />
        <Tile label="Servers" value={activeServers} unit={`of ${servers.length} linked`} lit={pct(activeServers, Math.max(servers.length, 1))} tone={activeServers || servers.length === 0 ? "go" : "caution"} />
        <Tile label="Tokens" value={tokens.length} unit="live" lit={pct(tokens.length, 6)} />
        <Tile label="Modules" value={live ? modulesOn : null} unit={live ? (onCard ? `${onCard} on card` : "all go") : "unknown"} lit={live ? pct(modulesOn, modules.length || 1) : 0} tone={onCard ? "mixed" : "go"} />
      </section>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,2.1fr)_minmax(320px,0.9fr)]">
        <section>
          <div className="section-heading mb-3">
            <Heading level={4} className="!mb-0">Systems Status Wall</Heading>
            <span className="section-count">{wallGo} / {wall.length}</span>
          </div>
          {!live ? (
            <div className="cold-instrument">
              <span className="cold-flag">No signal</span>
              <div className="cold-title">Status unavailable</div>
              <p className="cold-copy">{statusError || "The workstation did not report its systems."}</p>
            </div>
          ) : wall.length === 0 ? (
            <div className="cold-instrument">
              <span className="cold-flag">No signal</span>
              <div className="cold-title">The wall is cold</div>
              <p className="cold-copy">No modules or upstream servers reported yet.</p>
            </div>
          ) : (
            <div className="module-summary">
              <div className="module-summary-row wall-head">
                <span>System</span>
                <span>Tools</span>
                <span style={{ textAlign: "right" }}>Flag</span>
              </div>
              {wall.map((r) => (
                <div key={`${r.category}-${r.name}`} className={`module-summary-row ${r.tone === "ok" ? "" : "row-dim"}`}>
                  <div className="min-w-0">
                    <span className="truncate text-primary font-medium">{r.name}</span>
                    {r.category && <span className="ml-2 text-disabled text-[11px] uppercase tracking-[0.1em]">{r.category}</span>}
                  </div>
                  <span className="telemetry text-xs text-secondary">{r.count ?? "—"}</span>
                  <span style={{ textAlign: "right" }}>
                    <Badge tone={r.tone}>{r.flag}</Badge>
                  </span>
                  <span className="leader-note">{r.note}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-5 border-l border-border pl-5 xl:pl-7">
          <div className="preflight-panel">
            <div className="flex items-center justify-between gap-3">
              <Heading level={4} className="!mb-0">Pre-Flight</Heading>
              <Badge tone={stepsDone === 3 ? "ok" : "warn"}>{stepsDone} / 3 complete</Badge>
            </div>
            <Text type="supporting" size="sm" className="mt-2 leading-relaxed">
              Complete once, then every capability is available from one connection.
            </Text>
            <ol className="mt-4 quick-steps">
              <Step n={1} done={done1} text="Add an MCP server" action={<Btn variant="link" onClick={() => navigate("servers")}>Servers</Btn>} />
              <Step n={2} done={done2} text="Create an API token" action={<Btn variant="link" onClick={() => navigate("tokens")}>Tokens</Btn>} />
              <Step n={3} done={done3} text={<>Point your client at <code>/mcp</code></>} action={<Btn variant="link" onClick={() => navigate("connect")}>Guide</Btn>} />
            </ol>
          </div>

          <div className="mode-block">
            <div className="flex items-center justify-between gap-3">
              <Heading level={4} className="!mb-0">Catalog mode</Heading>
              <Badge tone={me?.liteCatalog ? "ok" : "neutral"}>{me?.liteCatalog ? "LITE" : "FULL"}</Badge>
            </div>
            <Text type="supporting" size="sm" className="leading-relaxed">
              {me?.liteCatalog
                ? "Clients see the five hub tools first and search the rest on demand — the token-cheap flight path."
                : "Clients receive the full tool list on every connect. Switch to lite for large catalogs."}
            </Text>
            <Btn variant="link" className="self-start" onClick={() => navigate("modules")}>Adjust</Btn>
          </div>

          <TrafficPanel />
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
  label: string; value: number | null; unit: string; lit: number; tone?: "go" | "caution" | "mixed" | "telemetry";
}) {
  const color =
    tone === "go" ? "var(--fd-go)" : tone === "caution" ? "var(--fd-caution)" :
    tone === "mixed" ? "var(--fd-caution)" : "var(--fd-telemetry)";
  return (
    <div className="power-on">
      <Text type="label" size="sm" className="text-secondary">{label}</Text>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="telemetry text-[34px] font-bold leading-none text-primary">{value ?? "—"}</span>
        <span className="telemetry text-[10.5px] uppercase tracking-[0.1em] text-disabled">{unit}</span>
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
      <span className={`telemetry flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] border text-[11px] font-bold ${done ? "flag-go" : "border-border text-secondary"}`}>
        {n}
      </span>
      <span className="min-w-0 flex-1 text-sm text-secondary">{text}</span>
      {action}
    </li>
  );
}

/** 14-day call traffic, straight from the usage_events rollup. */
function TrafficPanel() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadUsage()
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mode-block">
      <div className="flex items-center justify-between gap-3">
        <Heading level={4} className="!mb-0">Traffic</Heading>
        <span className="telemetry text-[10.5px] uppercase tracking-[0.12em] text-disabled">14d</span>
      </div>
      {failed ? (
        <Text type="supporting" size="sm">Traffic history is unavailable in single-user mode.</Text>
      ) : !usage ? (
        <div className="skeleton h-[44px] w-full" />
      ) : usage.totalCalls === 0 ? (
        <Text type="supporting" size="sm" className="leading-relaxed">
          No tool calls recorded yet. Traffic appears here once a client works through <code>/mcp</code>.
        </Text>
      ) : (
        <>
          <div className="traffic-bars" aria-hidden>
            {usage.series.map((d) => (
              <span
                key={d.date}
                className={`traffic-bar ${d.errors > 0 ? "has-errors" : ""}`}
                style={{ height: `${3 + (d.calls / Math.max(1, ...usage.series.map((x) => x.calls))) * 41}px` }}
                title={`${d.date} · ${d.calls} call${d.calls === 1 ? "" : "s"}${d.errors ? ` · ${d.errors} failed` : ""}`}
              />
            ))}
          </div>
          <div className="telemetry flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-secondary">
            <span>{usage.todayCalls} today</span>
            <span>{usage.avgLatencyMs}ms avg</span>
            {usage.totalErrors > 0 && <span className="text-[var(--fd-abort)]">{usage.totalErrors} failed</span>}
          </div>
          {usage.topTools[0] && (
            <div className="flex items-center gap-2 text-[12px] text-secondary">
              <span>busiest</span>
              <code className="module-card-tool-name">{usage.topTools[0].tool}</code>
              <span className="telemetry text-[11px] text-disabled">×{usage.topTools[0].calls}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
