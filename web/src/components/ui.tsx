import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { useToast } from "@astryxdesign/core/Toast";
import { Check, Copy, Inbox } from "lucide-react";
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

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "ok" | "off" | "warn" | "neutral";
  children: ReactNode;
}) {
  const cls =
    tone === "ok" ? "flag flag-go" : tone === "warn" ? "flag flag-card" : tone === "off" ? "flag flag-off" : "flag";
  return <span className={cls}>{children}</span>;
}

export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "http" | "stdio" | "official" | "neutral";
  children: ReactNode;
}) {
  // Transport/provenance plates: cyan is the telemetry register, green is verified.
  const cls =
    tone === "official" ? "flag flag-go" : tone === "http" || tone === "stdio" ? "flag flag-telemetry" : "flag";
  return <span className={cls}>{children}</span>;
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
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-border-emphasized hover:text-primary ${className}`}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon icon={copied ? Check : Copy} size="xsm" color={copied ? "success" : "secondary"} />
      {copied ? "Copied" : label}
    </button>
  );
}

/* ---------- Empty state ---------- */

export function Empty({ title = "Nothing here yet", children }: { title?: string; children: string }) {
  return (
    <EmptyState
      title={title}
      description={children}
      icon={<Icon icon={Inbox} size="lg" />}
    />
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
