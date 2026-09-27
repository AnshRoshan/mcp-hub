import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  errMsg, getSession, isUnauthorized, loadMe, loadServers, loadStatus, loadTokens, onUnauthorized,
  type MeData, type ServerRow, type SessionResult, type StatusData, type TokenRow, type User,
} from "./api";
import type { CatalogEntry } from "./catalog";

export type ViewKey = "dashboard" | "directory" | "connect" | "servers" | "tokens" | "credentials" | "modules" | "skills" | "settings";
type Phase = "loading" | "platform-off" | "auth" | "error" | "app";

interface ToastMsg { id: number; text: string }

const TOAST_DURATION_MS = 2400;

interface StoreValue {
  phase: Phase;
  user: User | null;
  status: StatusData | null;
  statusError: string | null;
  servers: ServerRow[];
  tokens: TokenRow[];
  me: MeData | null;
  view: ViewKey;
  error: string | null;
  toasts: ToastMsg[];
  prefill: { cat: string; entry: CatalogEntry } | null;
  navigate: (v: ViewKey) => void;
  toast: (msg: string) => void;
  retry: () => void;
  refreshAll: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setServers: Dispatch<SetStateAction<ServerRow[]>>;
  setTokens: Dispatch<SetStateAction<TokenRow[]>>;
  setStatus: Dispatch<SetStateAction<StatusData | null>>;
  setMe: Dispatch<SetStateAction<MeData | null>>;
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
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
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
  const refreshMe = useCallback(async () => setMe(await loadMe()), []);
  // Status is the only panel that can go cold without the session being
  // broken, so it records its failure instead of taking the whole boot down.
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await loadStatus());
      setStatusError(null);
    } catch (err) {
      setStatus(null);
      setStatusError(errMsg(err, "Status unavailable"));
    }
  }, []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshServers(), refreshTokens(), refreshStatus(), refreshMe()]);
  }, [refreshServers, refreshTokens, refreshStatus, refreshMe]);

  const applyPrefill = useCallback((p: { cat: string; entry: CatalogEntry } | null) => setPrefill(p), []);

  // Boot: session → platform off / auth / app.
  const boot = useCallback(async () => {
    setPhase("loading");
    setError(null);
    let s: SessionResult;
    try {
      s = await getSession();
    } catch (err) {
      setError(errMsg(err, "The workstation could not be reached."));
      setPhase("error");
      return;
    }
    if (s.kind === "off") {
      setPhase("platform-off");
      return;
    }
    if (s.kind === "signed-out") {
      setPhase("auth");
      return;
    }
    setUser(s.user);
    try {
      await refreshAll();
    } catch (err) {
      if (isUnauthorized(err)) {
        setUser(null);
        setError("Your session expired. Sign in again.");
        setPhase("auth");
      } else {
        // A 500 on /api/servers is not a reason to lose the session.
        setError(errMsg(err, "Your workspace could not be loaded."));
        setPhase("error");
      }
      return;
    }
    setPhase("app");
    // Resume an OAuth authorize round-trip the server parked here pre-login.
    const next = new URLSearchParams(window.location.search).get("authorize_return");
    if (next && next.startsWith("/oauth/authorize")) window.location.href = next;
  }, [refreshAll]);

  useEffect(() => {
    setError(null);
    void boot();
  }, [boot]);

  // Any 401 from any request lands here, once — the session is gone.
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        setError("Your session expired. Sign in again.");
        setPhase("auth");
      }),
    [],
  );

  const retry = useCallback(() => {
    void boot();
  }, [boot]);

  const value = useMemo<StoreValue>(
    () => ({
      phase, user, status, statusError, servers, tokens, me, view, error, toasts, prefill,
      navigate, toast, retry, refreshAll, refreshServers, refreshTokens,
      refreshStatus, refreshMe, setServers, setTokens, setStatus, setMe, applyPrefill,
    }),
    [phase, user, status, statusError, servers, tokens, me, view, error, toasts, prefill,
     navigate, toast, retry, refreshAll, refreshServers, refreshTokens, refreshStatus, refreshMe,
     setServers, setTokens, setStatus, setMe, applyPrefill],
  );

  return (
    <StoreCtx.Provider value={value}>
      {children}
    </StoreCtx.Provider>
  );
}
