import { useMemo, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Globe, Plus, Search } from "lucide-react";
import { MCP_CATALOG, catalogTotal, type CatalogEntry } from "../lib/catalog";
import { errMsg, registryKey, saveServer, searchRegistry, type RegistryServer } from "../lib/api";
import { useStore } from "../lib/store";
import { Btn, CopyBtn, Empty, Tag } from "../components/ui";
import { catalogIcon, CategoryIcon } from "../components/icons";

export default function Directory() {
  const { navigate, applyPrefill } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = Object.keys(MCP_CATALOG);
  const q = query.trim().toLowerCase();
  const visibleCategories = category === "all" ? categories : categories.filter((item) => item === category);
  const blocks = useMemo(
    () => visibleCategories.map((item) => {
      const entries = MCP_CATALOG[item].filter((entry) => !q || `${entry.name} ${entry.desc} ${item} ${entry.env.join(" ")}`.toLowerCase().includes(q));
      return entries.length ? { category: item, entries } : null;
    }).filter((block): block is { category: string; entries: CatalogEntry[] } => block !== null),
    [visibleCategories, q],
  );

  const add = (entry: CatalogEntry, sourceCategory: string) => {
    applyPrefill({ cat: sourceCategory, entry });
    navigate("servers");
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="page-intro">
        <div className="page-intro-copy">
          <Heading level={2}>Directory</Heading>
          <Text type="supporting" className="mt-1">Add a known server in one step, then configure credentials.</Text>
        </div>
        <div className="w-full sm:w-[280px]">
          <TextInput label="Search" isLabelHidden type="text" placeholder="Search servers…" startIcon={Search} hasClear width="100%" value={query} onChange={setQuery} />
        </div>
      </div>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1" aria-label="Directory categories">
        <Filter active={category === "all"} onClick={() => setCategory("all")}>All <span>{catalogTotal()}</span></Filter>
        {categories.map((item) => <Filter key={item} active={category === item} onClick={() => setCategory(item)}>{item} <span>{MCP_CATALOG[item].length}</span></Filter>)}
      </div>

      {blocks.length === 0 ? (
        <Empty title="No servers match">{`Nothing matches "${query}" — try another term.`}</Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {blocks.map((block) => (
            <section key={block.category} className="category-section">
              <div className="category-header">
                <span className="category-pill">
                  <CategoryIcon name={block.category} />
                  {block.category}
                </span>
                <Text type="label" size="sm" className="text-tertiary">
                  {block.entries.length} server{block.entries.length === 1 ? "" : "s"}
                </Text>
              </div>
              <div className="capability-list">
                {block.entries.map((entry) => <DirectoryRow key={entry.name} entry={entry} onAdd={() => add(entry, block.category)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <RegistrySection />
    </div>
  );
}

/** Live search against the official MCP Registry (proxied via /api/registry). */
function RegistrySection() {
  const { navigate, toast, refreshServers } = useStore();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<RegistryServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const runSearch = async () => {
    if (!term.trim() || busy) return;
    setBusy(true);
    try {
      setResults(await searchRegistry(term.trim()));
    } catch (err) {
      toast(errMsg(err, "Registry unreachable"));
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const importServer = async (s: RegistryServer) => {
    setAdding(s.name);
    try {
      await saveServer({ key: registryKey(s.name), type: "http", category: "Registry", env: {}, url: s.url });
      await refreshServers();
      toast(`Added ${s.name} — connect on the Servers page`);
      navigate("servers");
    } catch (err) {
      toast(errMsg(err, "Add failed"));
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="category-section">
      <div className="category-header">
        <span className="category-pill">
          <CategoryIcon name="Registry" />
          Official MCP Registry
        </span>
        <Text type="label" size="sm" className="text-tertiary">remote servers · live search</Text>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
      >
        <div className="max-w-md flex-1">
          <TextInput
            label="Search the registry"
            placeholder="e.g. postgres, sentry, obsidian…"
            startIcon={Globe}
            value={term}
            onChange={setTerm}
          />
        </div>
        <Btn variant="plate" type="submit" disabled={busy || !term.trim()}>{busy ? "Searching…" : "Search"}</Btn>
      </form>
      {results !== null && (
        results.length === 0 ? (
          <Text type="supporting" size="sm" className="mt-3">No remote servers found{busy ? " (still searching…)" : ""}.</Text>
        ) : (
          <div className="capability-list mt-3">
            {results.map((s) => (
              <article key={s.name} className="directory-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text weight="semibold">{s.name.split("/").pop()}</Text>
                    {s.version && <Tag>{s.version}</Tag>}
                    <Tag tone="http">{s.transport}</Tag>
                  </div>
                  <Text type="supporting" size="sm" className="mt-1 leading-relaxed line-clamp-2">{s.description}</Text>
                  <code className="mt-1 block truncate font-mono text-xs text-secondary" title={s.url}>{s.url}</code>
                </div>
                <div className="flex items-center gap-1.5">
                  <Btn variant="primary" icon={<Plus size={13} strokeWidth={2.6} />} disabled={adding !== null} onClick={() => void importServer(s)}>
                    {adding === s.name ? "Adding…" : "Add"}
                  </Btn>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </section>
  );
}

function Filter({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`telemetry flex-none rounded-[3px] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
        active
          ? "border-[color-mix(in_srgb,var(--fd-caution)_55%,transparent)] bg-[color-mix(in_srgb,var(--fd-caution)_12%,transparent)] text-[var(--fd-caution)]"
          : "border-border bg-surface text-secondary hover:border-border-emphasized hover:text-primary"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DirectoryRow({ entry, onAdd }: { entry: CatalogEntry; onAdd: () => void }) {
  const ServerIcon = catalogIcon(entry.name);
  return (
    <article className="directory-row">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-border bg-body text-secondary">
        <ServerIcon size={18} strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Text weight="semibold">{entry.name}</Text>
          <Tag tone={entry.by === "official" ? "official" : "neutral"}>{entry.by}</Tag>
          <Tag tone={entry.transport === "http" ? "http" : "stdio"}>{entry.transport}</Tag>
        </div>
        <Text type="supporting" size="sm" className="mt-1 leading-relaxed line-clamp-2">{entry.desc}</Text>
      </div>
      <div className="min-w-0">
        <code className="block truncate font-mono text-xs text-secondary" title={entry.cmd}>{entry.cmd}</code>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {entry.env.length === 0 ? <Tag>no keys</Tag> : entry.env.length <= 2 ? <Tag>{entry.env.join(", ")}</Tag> : <Tooltip content={`env: ${entry.env.join(", ")}`} placement="below" alignment="start"><Tag>{entry.env[0]} +{entry.env.length - 1}</Tag></Tooltip>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <CopyBtn text={entry.cmd} label="" />
        <Btn variant="primary" icon={<Plus size={13} strokeWidth={2.6} />} onClick={onAdd}>Add</Btn>
      </div>
    </article>
  );
}
