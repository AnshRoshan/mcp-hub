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
  Blocks, Cable, Compass, KeyRound, LayoutDashboard, LogOut, Server, Settings, ShieldCheck, Sparkles, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "../lib/api";
import { useStore, type ViewKey } from "../lib/store";

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
  const { view, navigate, user } = useStore();

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
          <div className="min-w-0">
            <Text type="label" size="sm" className="text-tertiary">MCP Workstation</Text>
            <Text size="sm" className="mt-0.5 truncate text-secondary">
              One endpoint for your enabled capabilities
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusDot variant="success" label="Online" />
            <Button
              label="Open endpoint"
              size="sm"
              variant="secondary"
              icon={<Icon icon={Cable} size="sm" />}
              onClick={() => window.open("/mcp", "_blank")}
            />
            <Avatar src={user?.image || undefined} name={user?.name || "Account"} alt="" size="sm" tooltip={false} />
          </div>
        </header>
        <main className="workstation-main">{children}</main>
      </div>
    </AppShell>
  );
}
