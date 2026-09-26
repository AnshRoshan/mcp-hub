import { useEffect, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Check, Trash2 } from "lucide-react";
import { deleteSecret, errMsg, loadSecrets, putSecret, type SecretSpec, type SecretsData } from "../lib/api";
import { useStore } from "../lib/store";
import { Badge, Btn, Empty, useConfirm } from "../components/ui";

export default function Credentials() {
  const { toast, refreshMe } = useStore();
  const [allowed, setAllowed] = useState<SecretSpec[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { ask, confirmEl } = useConfirm();

  const load = async () => {
    try {
      const data: SecretsData = await loadSecrets();
      setAllowed(data.allowed ?? []);
      setKeys(data.keys ?? []);
    } catch (err) {
      toast(errMsg(err, "Could not load credentials"));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const set = new Set(keys);
  const byModule: Record<string, SecretSpec[]> = {};
  for (const spec of allowed) (byModule[spec.module] = byModule[spec.module] || []).push(spec);

  const save = async (name: string) => {
    const value = (drafts[name] || "").trim();
    if (!value) return;
    setSaving(name);
    try {
      const res = await putSecret(name, value);
      setKeys(res.keys);
      setDrafts((d) => ({ ...d, [name]: "" }));
      toast("Saved — your tools pick it up on the next request");
    } catch (err) {
      toast(errMsg(err, "Save failed"));
    } finally {
      setSaving(null);
    }
  };

  const remove = async (name: string) => {
    const ok = await ask(`Remove ${name}?`, "Modules using it fall back to server credentials or switch off for you.", "Remove");
    if (!ok) return;
    try {
      await deleteSecret(name);
      setKeys((k) => k.filter((x) => x !== name));
      toast("Removed");
      void refreshMe();
    } catch (err) {
      toast(errMsg(err, "Remove failed"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Credentials</Heading>
          <Text type="supporting" className="mt-1 max-w-[72ch]">
            Connect your own accounts for the built-in modules. Stored values are encrypted at rest,
            never shown again, and take precedence over the server's own keys — only for you.
          </Text>
        </div>
      </div>

      {allowed.length === 0 ? (
        <Empty>Loading the credential catalog…</Empty>
      ) : (
        Object.entries(byModule).map(([mod, specs]) => (
          <section key={mod} className="flex flex-col gap-3">
            <Text type="label" color="secondary" className="uppercase tracking-[0.12em]">{mod}</Text>
            <div className="capability-list">
              {specs.map((spec) => {
                const isSet = set.has(spec.name);
                return (
                  <div key={spec.name} className="capability-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="text-primary">{spec.label}</span>
                        <code className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[10.5px] text-secondary">{spec.name}</code>
                        {isSet && (
                          <Badge tone="ok">
                            <span className="inline-flex items-center gap-1"><Check size={11} strokeWidth={2.6} /> set</span>
                          </Badge>
                        )}
                      </div>
                      {spec.hint && (
                        <Text type="supporting" size="sm" className="mt-0.5">{spec.hint}</Text>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-none items-end gap-2">
                      <div className="w-64 max-w-full">
                        <TextInput
                          label=""
                          type={/URL$/.test(spec.name) ? "text" : "password"}
                          placeholder={isSet ? "Replace value…" : "Paste value…"}
                          value={drafts[spec.name] ?? ""}
                          onChange={(v) => setDrafts((d) => ({ ...d, [spec.name]: v }))}
                        />
                      </div>
                      <Btn
                        variant="primary"
                        disabled={!(drafts[spec.name] ?? "").trim() || saving === spec.name}
                        onClick={() => save(spec.name)}
                      >
                        {saving === spec.name ? "Saving…" : "Save"}
                      </Btn>
                      {isSet && (
                        <Btn variant="danger" icon={<Trash2 size={12} />} onClick={() => remove(spec.name)}>
                          Remove
                        </Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {confirmEl}
    </div>
  );
}
