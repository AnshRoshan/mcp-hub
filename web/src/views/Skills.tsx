import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Eye } from "lucide-react";
import { errMsg, putSkills } from "../lib/api";
import { useStore } from "../lib/store";
import { Badge, Btn, Empty, FdSwitch } from "../components/ui";
import { CategoryIcon } from "../components/icons";

export default function Skills() {
  const { me, setMe, refreshMe, toast } = useStore();
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const skills = me?.skills || [];
  const byCategory: Record<string, typeof skills> = {};
  for (const skill of skills) (byCategory[skill.category] = byCategory[skill.category] || []).push(skill);

  const toggle = async (name: string, enabled: boolean) => {
    const next = new Set(skills.filter((skill) => skill.enabled).map((skill) => skill.name));
    if (enabled) next.add(name); else next.delete(name);
    try {
      await putSkills([...next]);
      setFailed(null);
      if (me) setMe({ ...me, skills: skills.map((skill) => ({ ...skill, enabled: next.has(skill.name) })) });
      else void refreshMe();
      toast(`Skill "${name}" ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      setFailed(errMsg(err, "Update failed"));
    }
  };

  const previewSkill = skills.find((skill) => skill.name === preview);

  return (
    <div className="flex flex-col gap-8">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Skills</Heading>
          <Text type="supporting" className="mt-1">
            Reusable instruction sets your agent follows — loaded via <code>skills_list</code> / <code>skills_get</code>.
          </Text>
        </div>
      </div>

      {failed && (
        <Banner
          status="error"
          title="Skill update failed"
          description={<>{failed} <Btn variant="link" onClick={() => void refreshMe()}>Reload skills</Btn></>}
        />
      )}

      {!me ? (
        <div className="card-grid">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-[150px] w-full" />)}
        </div>
      ) : skills.length === 0 ? (
        <Empty title="No skills published">Drop a <code>skills/*.md</code> file into the workstation and reload.</Empty>
      ) : (
        Object.entries(byCategory).map(([category, items]) => {
          const enabledCount = items.filter((skill) => skill.enabled).length;
          return (
            <section key={category} className="category-section">
              <div className="category-header">
                <span className="category-pill">
                  <CategoryIcon name={category} />
                  {category}
                </span>
                <Text type="label" size="sm" className="text-disabled">
                  {enabledCount}/{items.length} on
                </Text>
              </div>
              <div className="card-grid">
                {items.map((skill) => (
                  <article key={skill.name} className={`skill-card ${skill.enabled ? "" : "is-off"}`}>
                    <div className="skill-card-header">
                      <div className="skill-card-name">
                        <Text weight="semibold" size="sm">{skill.name}</Text>
                        <span className="telemetry rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] text-disabled">
                          v{skill.version}
                        </span>
                      </div>
                      <FdSwitch label={skill.name} checked={skill.enabled} onChange={(v) => toggle(skill.name, v)} />
                    </div>

                    <Text type="supporting" size="sm" className="skill-card-desc">
                      {skill.description}
                    </Text>

                    <div className="skill-card-footer">
                      {skill.content ? (
                        <Btn variant="link" icon={<Eye size={12} />} onClick={() => setPreview(skill.name)}>
                          Preview
                        </Btn>
                      ) : (
                        <span />
                      )}
                      <Badge tone={skill.enabled ? "ok" : "off"}>
                        {skill.enabled ? "active" : "off"}
                      </Badge>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}

      {previewSkill && (
        <Dialog isOpen onOpenChange={(open) => !open && setPreview(null)} width={760} maxHeight="80vh">
          <DialogHeader title={previewSkill.name} subtitle={`${previewSkill.category} · v${previewSkill.version}`} onOpenChange={(open) => !open && setPreview(null)} />
          <CodeBlock code={previewSkill.content || ""} language="markdown" title={`skills/${previewSkill.name}.md`} hasLineNumbers maxHeight="55vh" />
        </Dialog>
      )}
    </div>
  );
}
