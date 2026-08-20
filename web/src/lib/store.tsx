import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getSession, loadMe, loadServers, loadStatus, loadTokens,
  type MeData, type ServerRow, type StatusData, type TokenRow, type User,
} from "./api";
import type { CatalogEntry } from "./catalog";

export type ViewKey = "dashboard" | "directory" | "connect" | "servers" | "tokens" | "modules" | "skills" | "settings";
type Phase = "loading" | "platform-off" | "auth" | "app";

interface ToastMsg { id: number; text: string }

const TOAST_DURATION_MS = 2400;

interface StoreValue {
  phase: Phase;
  user: User | null;
  status: StatusData | null;
  servers: ServerRow[];
  tokens: TokenRow[];
  me: MeData | null;
  view: ViewKey;
  toasts: ToastMsg[];
  prefill: { cat: string; entry: CatalogEntry } | null;
  navigate: (v: ViewKey) => void;
  toast: (msg: string) => void;
  refreshAll: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setServers: (s: ServerRow[]) => void;
  setTokens: (t: TokenRow[]) => void;
  setStatus: (s: StatusData | null) => void;
  setMe: (m: MeData | null) => void;
  applyPrefill: (p: { cat: string; entry: CatalogEntry } | null) => void;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore outside provider");
  return v;
}

let toastId = 0;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [prefill, setPrefill] = useState<{ cat: string; entry: CatalogEntry } | null>(null);

  const toast = useCallback((msg: string) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, text: msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_DURATION_MS);
  }, []);

  const navigate = useCallback((v: ViewKey) => {
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const refreshServers = useCallback(async () => setServers(await loadServers()), []);
  const refreshTokens = useCallback(async () => setTokens(await loadTokens()), []);
  const refreshStatus = useCallback(async () => setStatus(await loadStatus()), []);
  const refreshMe = useCallback(async () => setMe(await loadMe()), []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshServers(), refreshTokens(), refreshStatus(), refreshMe()]);
  }, [refreshServers, refreshTokens, refreshStatus, refreshMe]);

  const applyPrefill = useCallback((p: { cat: string; entry: CatalogEntry } | null) => setPrefill(p), []);

  // Boot: session → platform off / auth / app.
  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (s.kind === "off") { setPhase("platform-off"); return; }
      if (s.kind === "signed-out") { setPhase("auth"); return; }
      setUser(s.user);
      try {
        await refreshAll();
        setPhase("app");
      } catch {
        setPhase("auth");
      }
    })();
  }, [refreshAll]);

  const value = useMemo<StoreValue>(
    () => ({
      phase, user, status, servers, tokens, me, view, toasts, prefill,
      navigate, toast, refreshAll, refreshServers, refreshTokens,
      refreshStatus, refreshMe, setServers, setTokens, setStatus, setMe, applyPrefill,
    }),
    [phase, user, status, servers, tokens, me, view, toasts, prefill,
     navigate, toast, refreshAll, refreshServers, refreshTokens, refreshStatus, refreshMe,
     setServers, setTokens, setStatus, setMe, applyPrefill],
  );

  return (
    <StoreCtx.Provider value={value}>
      {children}
    </StoreCtx.Provider>
  );
}
