import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Switch } from "@astryxdesign/core/Switch";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { errMsg, putPrefs, type ModuleInfo } from "../lib/api";
import { MODULES } from "../lib/catalog";
import { useStore } from "../lib/store";
import { Badge } from "../components/ui";
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

  return (
    <div className="flex flex-col gap-8">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Modules &amp; tools</Heading>
          <Text type="supporting" className="mt-1">
            Enable a complete integration or fine-tune access down to one tool. Changes apply only to your endpoint.
          </Text>
        </div>
        <Button label="Browse directory" variant="secondary" size="sm" icon={<ExternalLink size={13} />} onClick={() => navigate("directory")} />
      </div>

      {Object.entries(byCategory).map(([category, modules]) => {
        const onCount = modules.filter(([name, module]) => module.enabled !== false && !disabledModules.has(name)).length;
        return (
          <section key={category}>
            <div className="section-heading mb-3">
              <CategoryIcon name={category} />
              <Heading level={4} className="!mb-0">{category}</Heading>
              <span className="section-count">{onCount} / {modules.length} enabled</span>
            </div>
            <div className="capability-list">
              {modules.map(([name, module]) => {
                const meta = MODULES[name] || { icon: "blocks", desc: "" };
                const configOn = module.enabled !== false;
                const enabled = configOn && !disabledModules.has(name);
                const needsSetup = !configOn && Boolean(module.reason);
                const tools = module.tools || [];
                const toolCount = tools.filter((tool) => !disabledTools.has(tool)).length;
                const expanded = Boolean(open[name]);
                return (
                  <article key={name} className={`capability-row ${enabled ? "" : "is-off"}`}>
                    <div className="flex min-w-0 gap-3">
                      <ModuleIcon name={meta.icon} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Text weight="semibold">{name}</Text>
                          {enabled ? (
                            <Badge tone="ok">{toolCount} active</Badge>
                          ) : needsSetup ? (
                            <Tooltip content={module.reason} placement="below" alignment="start"><Badge tone="warn">setup needed</Badge></Tooltip>
                          ) : (
                            <Badge tone="off">disabled</Badge>
                          )}
                        </div>
                        <Text type="supporting" size="sm" className="mt-1 leading-relaxed">{meta.desc}</Text>
                        {tools.length > 0 && (
                          <Button
                            label={`${expanded ? "Hide" : "Configure"} ${tools.length} tool${tools.length === 1 ? "" : "s"}`}
                            variant="ghost"
                            size="sm"
                            className="mt-2"
                            icon={expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            onClick={() => setOpen((current) => ({ ...current, [name]: !current[name] }))}
                          />
                        )}
                      </div>
                    </div>
                    <Switch label={`Enable ${name}`} value={enabled} onChange={(value) => toggleModule(name, value)} />

                    {expanded && (
                      <div className="capability-tools">
                        <Text type="label" size="sm" className="px-2 text-tertiary">Individual tool access</Text>
                        <div className="mt-2 grid grid-cols-1 gap-1 lg:grid-cols-2">
                          {tools.map((tool) => (
                            <div key={tool} className="capability-tool">
                              <Switch label={`Enable ${tool}`} size="sm" value={!disabledTools.has(tool)} onChange={(value) => toggleTool(tool, value)} />
                              <code className="min-w-0 truncate font-mono text-xs text-secondary">{tool}</code>
                            </div>
                          ))}
                        </div>
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
