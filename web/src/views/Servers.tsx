import { useEffect, useRef, useState, type FormEvent } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteServer, errMsg, parseHeaders, parseKV, saveServer, toggleServer, type ServerBody, type ServerRow } from "../lib/api";
import { CATEGORY_MAP, FORM_CATEGORIES } from "../lib/catalog";
import { useStore } from "../lib/store";
import { Badge, Btn, Empty, FdSwitch, useConfirm } from "../components/ui";

const selectCls =
  "w-full rounded-[6px] border border-border-emphasized bg-background-body px-3 py-2 text-sm text-primary focus:outline-2 focus:outline-[var(--fd-telemetry)]";

interface ServerForm {
  key: string;
  category: string;
  type: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  headers: string;
}

const emptyForm = (): ServerForm => ({
  key: "", category: "Development", type: "stdio",
  command: "", args: "", cwd: "", url: "", env: "", headers: "",
});

export default function Servers() {
  const { servers, setServers, refreshAll, toast, prefill, applyPrefill } = useStore();
  const [editing, setEditing] = useState<ServerRow | "new" | null>(null);
  const [draft, setDraft] = useState<ServerRow | null>(null);
  const { ask, confirmEl } = useConfirm();
  const formTop = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<ServerForm>(emptyForm);

  useEffect(() => {
    if (prefill) {
      const { entry, cat } = prefill;
      const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const parts = entry.transport === "http" ? [] : entry.cmd.split(/\s+/);
      const d: ServerRow = {
        id: "",
        key: slug,
        type: entry.transport,
        category: CATEGORY_MAP[cat] || "Other",
        enabled: true,
        command: parts[0] || "",
        args: parts.slice(1),
        cwd: "",
        url: entry.transport === "http" ? entry.cmd : "",
        envKeys: [],
        headerKeys: [],
      };
      setDraft(d);
      setEditing("new");
      setForm({
        key: d.key, category: d.category || "Development", type: d.type,
        command: d.command || "", args: (d.args || []).join(", "), cwd: d.cwd || "",
        url: d.url || "", env: entry.env.map((k) => `${k}=`).join("\n"), headers: "",
      });
      applyPrefill(null);
      requestAnimationFrame(() => {
        formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        toast(`Prefilled "${entry.name}" — add your keys and save`);
      });
    }
  }, [prefill, applyPrefill, toast]);

  const openNew = () => {
    setEditing("new");
    setDraft(null);
    setForm(emptyForm());
    requestAnimationFrame(() => formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const openEdit = (s: ServerRow) => {
    setEditing(s);
    setForm({
      key: s.key, category: s.category || "Development", type: s.type,
      command: s.command || "", args: (s.args || []).join(", "), cwd: s.cwd || "",
      url: s.url || "", env: "", headers: "",
    });
    requestAnimationFrame(() => formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const close = () => { setEditing(null); setDraft(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const isEdit = editing !== "new" && editing !== null;
    const body: ServerBody = {
      key: form.key.trim(),
      type: form.type,
      category: form.category,
      env: parseKV(form.env),
      headers: form.type === "http" ? parseHeaders(form.headers) : undefined,
    };
    if (form.type === "stdio") {
      body.command = form.command.trim();
      body.args = form.args.split(",").map((s) => s.trim()).filter(Boolean);
      body.cwd = form.cwd.trim() || undefined;
    } else {
      body.url = form.url.trim();
    }
    try {
      await saveServer(body, isEdit ? (editing as ServerRow).id : undefined);
      close();
      toast(isEdit ? "Server updated" : "Server added");
      await refreshAll();
    } catch (err) {
      toast(errMsg(err, "Save failed"));
    }
  };

  const onToggle = async (s: ServerRow, v: boolean) => {
    try {
      await toggleServer(s.id, v);
      setServers(servers.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)));
    } catch (err) {
      toast(errMsg(err, "Toggle failed"));
    }
  };

  const onDelete = async (s: ServerRow) => {
    const ok = await ask(
      `Delete "${s.key}"?`,
      "This server stops appearing in your endpoint immediately. The config is removed and cannot be restored.",
      "Delete server",
    );
    if (!ok) return;
    try {
      await deleteServer(s.id);
      setServers(servers.filter((x) => x.id !== s.id));
      toast("Server deleted");
    } catch (err) {
      toast(errMsg(err, "Delete failed"));
    }
  };

  const detail = (s: ServerRow) =>
    s.type === "stdio"
      ? `${[s.command, ...(s.args || [])].join(" ")}${s.cwd ? ` · cwd: ${s.cwd}` : ""}${s.envKeys.length ? ` · env: ${s.envKeys.join(", ")}` : ""}`
      : `${s.url || ""}${s.headerKeys.length ? ` · headers: ${s.headerKeys.join(", ")}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Servers</Heading>
          <Text type="supporting" className="mt-1 max-w-[72ch]">
            Register MCP servers (stdio or HTTP). Tools are namespaced into your endpoint.
          </Text>
        </div>
        <Btn variant="primary" icon={<Plus size={13} strokeWidth={2.4} />} onClick={openNew}>Add server</Btn>
      </div>

      <div ref={formTop} />
      {editing && (
        <section className="panel">
          <div className="mb-2 flex items-center justify-between">
            <Heading level={4}>
              {editing === "new" ? (draft ? `Add ${draft.key}` : "Add server") : `Edit ${(editing as ServerRow).key}`}
            </Heading>
            <button type="button" className="btn-icon" aria-label="Close" onClick={close}>
              <X size={15} />
            </button>
          </div>
          <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              label="Name (tool prefix)"
              placeholder="myfiles"
              isRequired
              value={form.key}
              onChange={(v) => setForm({ ...form, key: v })}
              description="Tools from this server are namespaced under this prefix."
            />
            <div>
              <Text type="label" size="sm" className="mb-1.5 block text-secondary">Category</Text>
              <select className={selectCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {FORM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Text type="label" size="sm" className="mb-1.5 block text-secondary">Type</Text>
              <select className={selectCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "stdio" | "http" })}>
                <option value="stdio">stdio — local command</option>
                <option value="http">http — remote endpoint</option>
              </select>
            </div>
            {form.type === "http" ? (
              <TextInput label="URL" placeholder="https://example.com/mcp" value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
            ) : (
              <>
                <TextInput label="Command" placeholder="npx" isRequired value={form.command} onChange={(v) => setForm({ ...form, command: v })} />
                <TextInput label="Args (comma separated)" placeholder="-y, @modelcontextprotocol/server-filesystem" value={form.args} onChange={(v) => setForm({ ...form, args: v })} />
              </>
            )}
            {form.type === "stdio" && (
              <TextInput label="Working directory" placeholder="/path/to/project" isOptional value={form.cwd} onChange={(v) => setForm({ ...form, cwd: v })} />
            )}
            <div>
              <TextArea label="Environment (KEY=VALUE, one per line — stored encrypted)" rows={3} placeholder={"MY_API_KEY=secret\nOTHER=value"} value={form.env} onChange={(v) => setForm({ ...form, env: v })} />
            </div>
            {form.type === "http" && (
              <div>
                <TextArea label="HTTP headers (Key: Value, one per line)" rows={2} placeholder="Authorization: Bearer xxx" value={form.headers} onChange={(v) => setForm({ ...form, headers: v })} />
              </div>
            )}
            <div className="mt-2 flex justify-end gap-2.5 md:col-span-2">
              <Btn variant="plate" onClick={close}>Cancel</Btn>
              <Btn variant="primary" type="submit">Save</Btn>
            </div>
          </form>
        </section>
      )}

      {servers.length === 0 ? (
        <Empty>No servers yet. Add your first MCP server to get started.</Empty>
      ) : (
        <div className="capability-list">
          {servers.map((s) => (
            <div key={s.id} className="capability-row">
              <div className="flex items-center gap-3.5">
                <FdSwitch label={s.key} checked={s.enabled} onChange={(v) => onToggle(s, v)} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="text-primary">{s.key}</span>
                    <Badge>{s.type}</Badge>
                    {s.category && <Badge>{s.category}</Badge>}
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-xs text-secondary">{detail(s)}</code>
                </div>
              </div>
              <div className="flex flex-none gap-2">
                <Btn variant="plate" icon={<Pencil size={12} />} onClick={() => openEdit(s)}>Edit</Btn>
                <Btn variant="danger" icon={<Trash2 size={12} />} onClick={() => onDelete(s)}>Delete</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmEl}
    </div>
  );
}
