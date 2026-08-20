import { useState, type FormEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { copyText, createToken, errMsg, loadTokens, revokeToken } from "../lib/api";
import { useStore } from "../lib/store";
import { CopyBtn, Empty, useConfirm } from "../components/ui";

export default function Tokens() {
  const { tokens, setTokens, toast } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const { ask, confirmEl } = useConfirm();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await createToken(name.trim() || "API token");
      setName("");
      setCreating(false);
      setNewToken(res.token.token);
      setTokens(await loadTokens());
    } catch (err) {
      toast(errMsg(err, "Create failed"));
    }
  };

  const revoke = async (id: string, tokenName: string) => {
    const ok = await ask(
      `Revoke “${tokenName}”?`,
      "Clients using this token lose access immediately. The token cannot be recovered.",
      "Revoke token",
    );
    if (!ok) return;
    try {
      await revokeToken(id);
      setTokens(tokens.filter((t) => t.id !== id));
      toast("Token revoked");
    } catch (err) {
      toast(errMsg(err, "Revoke failed"));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <Heading level={2}>Tokens</Heading>
          <Text type="supporting" className="mt-1 max-w-[72ch]">
            Authenticate your MCP clients. Pass as a Bearer token on every request to <code>/mcp</code>.
          </Text>
        </div>
        <Button
          label="Create token"
          variant="primary"
          icon={<Plus size={15} strokeWidth={2.4} />}
          onClick={() => { setCreating(true); setNewToken(null); }}
        />
      </div>

      {creating && (
        <Card padding={5}>
          <Heading level={4}>New API token</Heading>
          <form onSubmit={create} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <TextInput
                label="Name"
                placeholder="Claude Code"
                value={name}
                onChange={setName}
              />
            </div>
            <Button label="Create" variant="primary" type="submit" />
          </form>
        </Card>
      )}

      {newToken && (
        <Card padding={5} variant="green">
          <Heading level={4}>Your new token — copy it now, it won't be shown again</Heading>
          <div className="mt-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <code className="block flex-1 break-all rounded-md border border-border bg-surface p-3 font-mono text-sm text-primary">
              {newToken}
            </code>
            <Button
              label="Copy token"
              variant="primary"
              icon={<KeyRound size={15} />}
              onClick={async () => {
                await copyText(newToken);
                toast("Token copied");
              }}
            />
          </div>
        </Card>
      )}

      {tokens.length === 0 ? (
        <Empty>No tokens yet. Create one to connect your MCP client.</Empty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tokens.map((t) => (
            <Card key={t.id} padding={3}>
              <div className="flex flex-wrap items-center gap-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="text-primary">{t.name}</span>
                    <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[10.5px] text-secondary">
                      …{t.hint}
                    </span>
                  </div>
                  <Text type="supporting" size="sm" className="mt-0.5">
                    <Tooltip content={new Date(t.createdAt).toLocaleString()} placement="below" alignment="start">
                      <span>Created {timeAgo(t.createdAt)}</span>
                    </Tooltip>
                    {" · "}
                    {t.lastUsedAt ? (
                      <Tooltip content={new Date(t.lastUsedAt).toLocaleString()} placement="below" alignment="start">
                        <span>last used {timeAgo(t.lastUsedAt)}</span>
                      </Tooltip>
                    ) : (
                      "last used never"
                    )}
                  </Text>
                </div>
                <div className="flex flex-none flex-wrap gap-2">
                  <CopyBtn text={`Authorization: Bearer …${t.hint}`} label="Copy auth header" />
                  <Button
                    label="Revoke"
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    className="!text-red-vivid hover:!border-red-ring"
                    onClick={() => revoke(t.id, t.name)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {confirmEl}
    </div>
  );
}

/** Compact relative timestamp; hover a token row for the exact date. */
function timeAgo(iso: string): string {
  const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 52) return `${wks}w ago`;
  return `${Math.floor(days / 365)}y ago`;
}
