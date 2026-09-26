import { useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  Blocks, Cable, Compass, KeyRound, LayoutDashboard, LogOut, Moon, Server, Settings, ShieldCheck, Sparkles, Sun, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "../lib/api";
import { MODULES } from "../lib/catalog";
import { useStore, type ViewKey } from "../lib/store";
import { setThemeMode, useThemeMode } from "../theme";

const NAV: { group: string; color: string; items: { view: ViewKey; label: string; Icon: LucideIcon }[] }[] = [
  {
    group: "Console",
    color: "text-primary",
    items: [{ view: "dashboard", label: "Dashboard", Icon: LayoutDashboard }],
  },
  {
    group: "Discover",
    color: "text-accent",
    items: [
      { view: "directory", label: "MCP Directory", Icon: Compass },
      { view: "connect", label: "Connect", Icon: Cable },
    ],
  },
  {
    group: "Manage",
    color: "text-secondary",
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
    color: "text-tertiary",
    items: [{ view: "settings", label: "Settings", Icon: Settings }],
  },
];

function BrandHeading() {
  return (
    <SideNavHeading
      heading="MCP Workstation"
      icon={
        <NavIcon
          icon={
            <span className="flex h-4 w-4 items-center justify-center">
              <Zap size={15} strokeWidth={2.4} />
            </span>
          }
        />
      }
    />
  );
}

function SideNavFooter() {
  const { user, navigate } = useStore();
  const name = user?.name || "Account";
  return (
    <div className="border-t border-border px-3 pb-3 pt-3">
      <VStack gap={1.5}>
        <div className="flex items-center gap-2 px-1.5">
          <StatusDot variant="success" label="Endpoint online" />
          <Text type="label" size="sm" className="text-secondary">
            Endpoint online
          </Text>
        </div>
        <Button
          label="Endpoint"
          size="sm"
          variant="secondary"
          width="100%"
          className="justify-start"
          icon={<Icon icon={Cable} size="sm" />}
          onClick={() => window.open("/mcp", "_blank")}
        />
        <div className="my-1 h-px bg-border" aria-hidden />
        <DropdownMenu
          hasChevron
          placement="above"
          alignment="start"
          button={{
            label: name,
            variant: "ghost",
            width: "100%",
            className: "justify-start",
            icon: (
              <Avatar
                src={user?.image || undefined}
                name={name}
                alt=""
                size="sm"
                tooltip={false}
              />
            ),
          }}
        items={[
          {
            type: "section",
            title: user?.name
              ? `${user.name}${user?.email ? ` · ${user.email}` : ""}`
              : user?.email || "Signed in",
            items: [
              {
                label: "Settings",
                icon: Settings,
                onClick: () => navigate("settings"),
              },
            ],
          },
          { type: "divider" },
          {
            label: "Sign out",
            icon: LogOut,
            variant: "destructive",
            onClick: () => signOut(),
          },
        ]}
      />
      </VStack>
    </div>
  );
}

export function AppShellLayout({ children }: { children: React.ReactNode }) {
  const { view, navigate, user, status, me } = useStore();

  const modules = (status?.modules || []).filter((m) => MODULES[m.name]);
  const disabled = new Set(me?.disabledModules || []);
  const go = modules.filter((m) => m.enabled && !disabled.has(m.name)).length;
  const card = modules.filter((m) => m.enabled && disabled.has(m.name)).length + modules.filter((m) => !m.enabled).length;

  const navSections = NAV.map((g) => (
    <SideNavSection key={g.group} title={g.group}>
      {g.items.map(({ view: v, label, Icon }) => {
        const active = view === v;
        return (
          <SideNavItem
            key={v}
            label={label}
            icon={Icon}
            isSelected={active}
            onClick={() => navigate(v)}
            className={
              active
                ? "!bg-primary/[0.08] !text-primary font-medium"
                : `hover:${g.color}`
            }
          />
        );
      })}
    </SideNavSection>
  ));

  return (
    <AppShell
      variant="elevated"
      contentPadding={6}
      sideNav={
        <SideNav header={<BrandHeading />} footer={<SideNavFooter />}>
          {navSections}
        </SideNav>
      }
      mobileNav={{ hasToggle: true }}
    >
      <div className="workstation-frame">
        <header className="workstation-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-border">
              <Zap size={13} strokeWidth={2.4} className="text-primary" />
            </span>
            <span className="telemetry text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              MCP Workstation
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="hidden items-center gap-2 sm:flex" title="Endpoint uplink">
              <span className="uplink-led" aria-hidden />
              <span className="telemetry text-[11px] uppercase tracking-[0.12em] text-secondary">/mcp linked</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 md:flex" aria-label={`${go} systems go, ${card} need attention`}>
              <span className="flag flag-go">GO {go}</span>
              <span className="flag flag-card">CARD {card}</span>
            </span>
            <UtcClock />
            <ThemeToggle />
            <Avatar src={user?.image || undefined} name={user?.name || "Account"} alt="" size="sm" tooltip={false} />
          </div>
        </header>
        <main className="workstation-main">{children}</main>
      </div>
    </AppShell>
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
