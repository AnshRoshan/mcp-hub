import { useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { errMsg, putPrefs, type ModuleInfo } from "../lib/api";
import { MODULES } from "../lib/catalog";
import { useStore } from "../lib/store";
import { Badge, Btn, FdSwitch } from "../components/ui";
import { CategoryIcon, ModuleIcon } from "../components/icons";

export default function Modules() {
  const { status, me, setMe, navigate, toast } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const known = (status?.modules || []).filter((m) => MODULES[m.name]);
  const sources: [string, ModuleInfo][] = known.length
    ? known.map((m) => [m.name, m])
    : Object.entries(MODULES).map(([name]) => [name, { name, enabled: true, tools: [], toolCount: 0 }]);
  const byCategory: Record<string, [string, ModuleInfo][]> = {};
  for (const [name, module] of sources) (byCategory[module.category || "Utilities"] = byCategory[module.category || "Utilities"] || []).push([name, module]);
  const disabledModules = new Set(me?.disabledModules || []);
  const disabledTools = new Set(me?.disabledTools || []);

  const toggleModule = async (name: string, enabled: boolean) => {
    const next = new Set(disabledModules);
    if (enabled) next.delete(name); else next.add(name);
    try {
      await putPrefs({ disabledModules: [...next] });
      setMe(me ? { ...me, disabledModules: [...next] } : me);
    } catch (err) {
      toast(errMsg(err, "Update failed"));
    }
  };

  const toggleTool = async (tool: string, enabled: boolean) => {
    const next = new Set(disabledTools);
    if (enabled) next.delete(tool); else next.add(tool);
    try {
      await putPrefs({ disabledTools: [...next] });
      setMe(me ? { ...me, disabledTools: [...next] } : me);
    } catch (err) {
      toast(errMsg(err, "Update failed"));
    }
  };

  const toggleLite = async (checked: boolean) => {
    try {
      await putPrefs({ liteCatalog: checked });
      setMe(me ? { ...me, liteCatalog: checked } : me);
    } catch (err) {
      toast(errMsg(err, "Update failed"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Modules &amp; tools</Heading>
          <Text type="supporting" className="mt-1">
            Enable integrations or fine-tune access per tool. Changes apply to your endpoint.
          </Text>
        </div>
        <Btn variant="plate" icon={<ExternalLink size={13} />} onClick={() => navigate("directory")}>Browse directory</Btn>
      </div>

      <div className="capability-list">
        <div className="capability-row">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span className="text-primary">Lite catalog (search-first)</span>
              <Badge tone={me?.liteCatalog ? "ok" : "neutral"}>{me?.liteCatalog ? "on" : "off"}</Badge>
            </div>
            <Text type="supporting" size="sm" className="mt-0.5 max-w-[80ch]">
              Expose only the hub tools (<code>hub_search_tools</code>, <code>hub_get_tool</code>, <code>hub_call</code>)
              and hide the rest behind them, so an agent's <code>tools/list</code> costs a fraction of the tokens.
              Best for clients with large catalogs; turn off to list every tool statically.
            </Text>
          </div>
          <div className="flex flex-none items-center gap-2">
            <FdSwitch label="Lite catalog" checked={Boolean(me?.liteCatalog)} onChange={toggleLite} />
          </div>
        </div>
      </div>

      {Object.entries(byCategory).map(([category, modules]) => {
        const onCount = modules.filter(([name, module]) => module.enabled !== false && !disabledModules.has(name)).length;
        const totalTools = modules.reduce((sum, [, m]) => sum + (m.tools?.length || 0), 0);
        return (
          <section key={category} className="category-section">
            <div className="category-header">
              <span className="category-pill">
                <CategoryIcon name={category} />
                {category}
              </span>
              <Text type="label" size="sm" className="text-tertiary">
                {onCount}/{modules.length} on · {totalTools} tools
              </Text>
            </div>
            <div className="card-grid">
              {modules.map(([name, module]) => {
                const meta = MODULES[name] || { icon: "blocks", desc: "" };
                const configOn = module.enabled !== false;
                const enabled = configOn && !disabledModules.has(name);
                const needsSetup = !configOn && Boolean(module.reason);
                const tools = module.tools || [];
                const enabledTools = tools.filter((tool) => !disabledTools.has(tool));
                const expanded = Boolean(open[name]);

                return (
                  <article key={name} className={`module-card ${enabled ? "" : "is-off"}`}>
                    <div className="module-card-header">
                      <ModuleIcon name={meta.icon} />
                      <div className="module-card-body">
                        <div className="module-card-title">
                          <Text weight="semibold" size="sm">{name}</Text>
                          {enabled ? (
                            <Badge tone="ok">on</Badge>
                          ) : needsSetup ? (
                            <Tooltip content={module.reason} placement="below" alignment="start">
                              <Badge tone="warn">setup</Badge>
                            </Tooltip>
                          ) : (
                            <Badge tone="off">off</Badge>
                          )}
                        </div>
                        <Text type="supporting" size="sm" className="module-card-desc">{meta.desc}</Text>
                      </div>
                      <FdSwitch label={name} checked={enabled} onChange={(v) => toggleModule(name, v)} />
                    </div>

                    <div className="module-card-meta">
                      <span>{enabledTools.length}/{tools.length} tools</span>
                    </div>

                    {tools.length > 0 && (
                      <div className="module-card-tools">
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-secondary transition-colors hover:text-primary"
                          onClick={() => setOpen((c) => ({ ...c, [name]: !c[name] }))}
                        >
                          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {expanded ? "Hide" : "Configure"} {tools.length} tool{tools.length === 1 ? "" : "s"}
                        </button>

                        {expanded && (
                          <div className="mt-2 flex flex-col gap-0.5">
                            {tools.map((tool) => (
                              <div key={tool} className="module-card-tool-row">
                                <code className="module-card-tool-name">{tool}</code>
                                <FdSwitch label={tool} checked={!disabledTools.has(tool)} onChange={(v) => toggleTool(tool, v)} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
