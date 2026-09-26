import { useEffect, useState } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import {
  Blocks, Cable, Compass, KeyRound, LayoutDashboard, LogOut, Moon, Server, Settings, ShieldCheck, Sparkles, Sun, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "../lib/api";
import { MODULES } from "../lib/catalog";
import { useStore, type ViewKey } from "../lib/store";
import { setThemeMode, useThemeMode } from "../theme";

const NAV: { group: string; items: { view: ViewKey; label: string; Icon: LucideIcon }[] }[] = [
  {
    group: "Console",
    items: [{ view: "dashboard", label: "Dashboard", Icon: LayoutDashboard }],
  },
  {
    group: "Discover",
    items: [
      { view: "directory", label: "MCP Directory", Icon: Compass },
      { view: "connect", label: "Connect", Icon: Cable },
    ],
  },
  {
    group: "Manage",
    items: [
      { view: "servers", label: "Servers", Icon: Server },
      { view: "tokens", label: "API Tokens", Icon: KeyRound },
      { view: "credentials", label: "Credentials", Icon: ShieldCheck },
      { view: "modules", label: "Modules & Tools", Icon: Blocks },
      { view: "skills", label: "Skills", Icon: Sparkles },
    ],
  },
  {
    group: "Account",
    items: [{ view: "settings", label: "Settings", Icon: Settings }],
  },
];

const VIEW_LABEL: Record<ViewKey, { group: string; label: string }> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.view, { group: g.group, label: i.label }])),
) as Record<ViewKey, { group: string; label: string }>;

export function AppShellLayout({ children }: { children: React.ReactNode }) {
  const { view, navigate, user, status, me } = useStore();
  const [railOpen, setRailOpen] = useState(false);

  const modules = (status?.modules || []).filter((m) => MODULES[m.name]);
  const disabled = new Set(me?.disabledModules || []);
  const go = modules.filter((m) => m.enabled && !disabled.has(m.name)).length;
  const card = modules.filter((m) => m.enabled && disabled.has(m.name)).length + modules.filter((m) => !m.enabled).length;

  const goView = (v: ViewKey) => {
    navigate(v);
    setRailOpen(false);
  };

  return (
    <div className="fd-frame">
      <div className={`rail-scrim ${railOpen ? "is-open" : ""}`} onClick={() => setRailOpen(false)} aria-hidden />
      <aside className={`fd-rail ${railOpen ? "is-open" : ""}`}>
        <div className="rail-mark">
          <span className="bolt-plate">
            <Zap size={15} strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <div className="telemetry truncate text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              MCP Workstation
            </div>
            <div className="telemetry mt-0.5 text-[10px] uppercase tracking-[0.14em] text-disabled">
              Flight ops · v0.1
            </div>
          </div>
        </div>

        <nav className="rail-nav" aria-label="Workstation sections">
          {NAV.map((g) => (
            <div key={g.group} className="rail-group">
              <div className="rail-heading">{g.group}</div>
              {g.items.map(({ view: v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  className={`rail-item ${view === v ? "is-active" : ""}`}
                  aria-current={view === v ? "page" : undefined}
                  onClick={() => goView(v)}
                >
                  <Icon size={15} strokeWidth={2} aria-hidden />
                  <span className="min-w-0 truncate">{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="uplink-block">
            <span className={`uplink-led ${status ? "" : "is-down"}`} aria-hidden />
            <div className="min-w-0">
              <div className="telemetry text-[10px] uppercase tracking-[0.16em] text-disabled">Uplink</div>
              <div className="telemetry truncate text-[11.5px] text-primary" title={`${window.location.origin}/mcp`}>
                {window.location.origin.replace(/^https?:\/\//, "")}/mcp
              </div>
            </div>
            <button type="button" className="btn-icon" title="Open the endpoint" aria-label="Open the MCP endpoint" onClick={() => window.open("/mcp", "_blank")}>
              <Cable size={13} strokeWidth={2} />
            </button>
          </div>
          <AccountPlate />
        </div>
      </aside>

      <div className="fd-main">
        <header className="workstation-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-icon rail-toggle"
              aria-label={railOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={railOpen}
              onClick={() => setRailOpen((o) => !o)}
            >
              <span className="hamburger" data-open={railOpen} aria-hidden>
                <span /><span /><span />
              </span>
            </button>
            <span className="telemetry text-[11px] uppercase tracking-[0.16em] text-disabled">
              {VIEW_LABEL[view]?.group}
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="telemetry text-[12px] font-semibold uppercase tracking-[0.1em] text-primary">
              {VIEW_LABEL[view]?.label}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 md:flex" aria-label={`${go} systems go, ${card} need attention`}>
              <span className="flag flag-go">GO {go}</span>
              <span className="flag flag-card">CARD {card}</span>
            </span>
            <UtcClock />
            <ThemeToggle />
          </div>
        </header>
        <main className="workstation-main">{children}</main>
      </div>
    </div>
  );
}

function AccountPlate() {
  const { user, navigate } = useStore();
  const name = user?.name || "Account";
  return (
    <DropdownMenu
      hasChevron={false}
      placement="above"
      alignment="start"
      button={{
        label: name,
        variant: "ghost",
        width: "100%",
        className: "account-plate",
        icon: <Avatar src={user?.image || undefined} name={name} alt="" size="sm" tooltip={false} />,
      }}
      items={[
        {
          type: "section",
          title: user?.name ? `${user.name}${user?.email ? ` · ${user.email}` : ""}` : user?.email || "Signed in",
          items: [{ label: "Settings", icon: Settings, onClick: () => navigate("settings") }],
        },
        { type: "divider" },
        { label: "Sign out", icon: LogOut, variant: "destructive", onClick: () => signOut() },
      ]}
    />
  );
}

/** DAY/NIGHT selector — switches the cockpit between console and paper. */
function ThemeToggle() {
  const mode = useThemeMode();
  const night = mode === "dark";
  return (
    <button
      type="button"
      className="theme-plate"
      title={night ? "Switch to daylight register" : "Switch to night console"}
      aria-label={night ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setThemeMode(night ? "light" : "dark")}
    >
      {night ? <Sun size={13} strokeWidth={2} /> : <Moon size={13} strokeWidth={2} />}
      <span className="telemetry hidden text-[10px] font-bold uppercase tracking-[0.14em] sm:inline">
        {night ? "Day" : "Night"}
      </span>
    </button>
  );
}

/** UTC mission clock — a measurement, so it lives in the mono register. */
function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return (
    <span className="telemetry text-[11px] tracking-[0.08em] text-secondary" title="Coordinated Universal Time">
      {hh}:{mm}:{ss}Z
    </span>
  );
}
