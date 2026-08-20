import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Switch } from "@astryxdesign/core/Switch";
import { Eye } from "lucide-react";
import { errMsg, putSkills } from "../lib/api";
import { useStore } from "../lib/store";
import { Badge } from "../components/ui";
import { CategoryIcon } from "../components/icons";

export default function Skills() {
  const { me, setMe, toast } = useStore();
  const [preview, setPreview] = useState<string | null>(null);
  const skills = me?.skills || [];
  const byCategory: Record<string, typeof skills> = {};
  for (const skill of skills) (byCategory[skill.category] = byCategory[skill.category] || []).push(skill);

  const toggle = async (name: string, enabled: boolean) => {
    const next = new Set(skills.filter((skill) => skill.enabled).map((skill) => skill.name));
    if (enabled) next.add(name); else next.delete(name);
    try {
      await putSkills([...next]);
      setMe(me ? { ...me, skills: skills.map((skill) => ({ ...skill, enabled: next.has(skill.name) })) } : me);
      toast(`Skill “${name}” ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast(errMsg(err, "Update failed"));
    }
  };

  const previewSkill = skills.find((skill) => skill.name === preview);

  return (
    <div className="flex flex-col gap-8">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Skills hub</Heading>
          <Text type="supporting" className="mt-1">
            Reusable instruction sets available to your agent through <code>skills_list</code> and <code>skills_get</code>.
          </Text>
        </div>
      </div>

      {Object.entries(byCategory).map(([category, items]) => {
        const enabledCount = items.filter((skill) => skill.enabled).length;
        return (
          <section key={category}>
            <div className="section-heading mb-3">
              <CategoryIcon name={category} />
              <Heading level={4} className="!mb-0">{category}</Heading>
              <span className="section-count">{enabledCount} / {items.length} enabled</span>
            </div>
            <div className="capability-list">
              {items.map((skill) => (
                <article key={skill.name} className={`capability-row ${skill.enabled ? "" : "is-off"}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text weight="semibold">{skill.name}</Text>
                      <code className="font-mono text-[11px] text-tertiary">v{skill.version}</code>
                      <Badge tone={skill.enabled ? "ok" : "off"}>{skill.enabled ? "enabled" : "disabled"}</Badge>
                    </div>
                    <Text type="supporting" size="sm" className="mt-1 leading-relaxed">{skill.description}</Text>
                    {skill.content && (
                      <Button label="Preview instructions" variant="ghost" size="sm" className="mt-2" icon={<Eye size={13} />} onClick={() => setPreview(skill.name)} />
                    )}
                  </div>
                  <Switch label={`Enable ${skill.name}`} value={skill.enabled} onChange={(value) => toggle(skill.name, value)} />
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {previewSkill && (
        <Dialog isOpen onOpenChange={(open) => !open && setPreview(null)} width={760} maxHeight="80vh">
          <DialogHeader title={previewSkill.name} subtitle={`${previewSkill.category} · v${previewSkill.version}`} onOpenChange={(open) => !open && setPreview(null)} />
          <CodeBlock code={previewSkill.content || ""} language="markdown" title={`skills/${previewSkill.name}.md`} hasLineNumbers maxHeight="55vh" />
        </Dialog>
      )}
    </div>
  );
}
