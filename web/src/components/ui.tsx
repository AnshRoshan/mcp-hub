import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { useToast } from "@astryxdesign/core/Toast";
import { Check, Copy, Radio } from "lucide-react";
import { copyText } from "../lib/api";
import { useStore } from "../lib/store";

/* ---------- Toasts: bridge store.toast() → Astryx ToastViewport ---------- */

export function ToastBridge() {
  const { toasts } = useStore();
  const toast = useToast();
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const t of toasts) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      toast({ body: t.text, uniqueID: String(t.id) });
    }
    // Drop ids that have left the store so the same toast can be re-shown.
    seen.current = new Set(toasts.map((t) => t.id));
  }, [toasts, toast]);

  return null;
}

/* ---------- Stamped state flags (Flight Dynamics state law) ---------- */

type FlagTone = "go" | "card" | "off" | "telemetry" | "neutral";

function Flag({ tone, children }: { tone: FlagTone; children: ReactNode }) {
  return <span className={tone === "neutral" ? "flag" : `flag flag-${tone}`}>{children}</span>;
}

const BADGE_TONES: Record<"ok" | "off" | "warn" | "neutral", FlagTone> = {
  ok: "go", warn: "card", off: "off", neutral: "neutral",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "ok" | "off" | "warn" | "neutral";
  children: ReactNode;
}) {
  return <Flag tone={BADGE_TONES[tone]}>{children}</Flag>;
}

const TAG_TONES: Record<"http" | "stdio" | "official" | "neutral", FlagTone> = {
  // Transport/provenance plates: cyan is the telemetry register, green is verified.
  official: "go", http: "telemetry", stdio: "telemetry", neutral: "neutral",
};

export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "http" | "stdio" | "official" | "neutral";
  children: ReactNode;
}) {
  return <Flag tone={TAG_TONES[tone]}>{children}</Flag>;
}

/* ---------- Key/value row ---------- */

export function Kv({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <MetadataListItem label={k}>
      <code className={`break-all text-right font-mono text-[12.5px] ${mono ? "text-primary" : "text-accent"}`}>{v}</code>
    </MetadataListItem>
  );
}

export function KvList({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <MetadataList title={title} columns="single" label={{ position: "start", width: 150 }}>
      {children}
    </MetadataList>
  );
}

/* ---------- Copy button ---------- */

export function CopyBtn({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current !== null) clearTimeout(reset.current); }, []);
  return (
    <button
      type="button"
      className={`btn-icon ${copied ? "is-copied" : ""} ${className}`}
      aria-label={label || (copied ? "Copied" : "Copy to clipboard")}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        if (reset.current !== null) clearTimeout(reset.current);
        reset.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon icon={copied ? Check : Copy} size="xsm" color={copied ? "success" : "secondary"} />
      {label && <span className="telemetry text-[10.5px] uppercase tracking-[0.12em]">{copied ? "Copied" : label}</span>}
    </button>
  );
}

/* ---------- Machined controls: the Flight Dynamics substrate ---------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "plate" | "link" | "danger";
  icon?: ReactNode;
};

export function Btn({ variant = "plate", icon, className = "", children, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Square detent switch — two positions, no pill anywhere. */
export function FdSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`fd-switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="fd-knob" aria-hidden />
    </button>
  );
}

/** Detent tab rail — active plate carries a top telemetry bar. */
export function TabRail<T extends string>({ items, value, onChange, idBase = "tabs" }: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  idBase?: string;
}) {
  const tabId = (id: T) => `${idBase}-tab-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = items.findIndex((t) => t.id === value);
    const next = items[(at + step + items.length) % items.length];
    if (next) onChange(next.id);
  };

  return (
    <div className="tab-rail" role="tablist" aria-label="Client targets" onKeyDown={onKeyDown}>
      {items.map((t) => (
        <button
          key={t.id}
          id={tabId(t.id)}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`${idBase}-panel`}
          tabIndex={value === t.id ? 0 : -1}
          className={`tab-plate ${value === t.id ? "is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The single panel a TabRail drives. */
export function TabPanel({ idBase, activeId, className = "", children }: {
  idBase: string;
  activeId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`${idBase}-panel`}
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={`${idBase}-tab-${activeId}`}
      className={className}
    >
      {children}
    </div>
  );
}

/* ---------- Cold-instrument empty state ---------- */

export function Empty({ title = "Nothing here yet", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="cold-instrument">
      <span className="cold-flag">
        <Icon icon={Radio} size="xsm" />
        No signal
      </span>
      <div className="cold-title">{title}</div>
      <p className="cold-copy">{children}</p>
    </div>
  );
}

/* ---------- Confirm dialog (replaces window.confirm) ---------- */

interface ConfirmOpts {
  title: string;
  description: string;
  actionLabel?: string;
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const ask = (title: string, description: string, actionLabel = "Delete") =>
    new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOpts({ title, description, actionLabel });
    });

  const settle = (result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOpts(null);
  };

  const el = opts ? (
    <AlertDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={opts.title}
      description={opts.description}
      cancelLabel="Cancel"
      actionLabel={opts.actionLabel || "Delete"}
      actionVariant="destructive"
      onAction={() => settle(true)}
    />
  ) : null;

  return { ask, confirmEl: el };
}
