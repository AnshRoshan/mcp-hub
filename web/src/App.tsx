import { ToastViewport } from "@astryxdesign/core/Toast";
import { AppShellLayout } from "./components/Shell";
import { ToastBridge } from "./components/ui";
import { StoreProvider, useStore, type ViewKey } from "./lib/store";
import AuthView from "./views/AuthView";
import Connect from "./views/Connect";
import Credentials from "./views/Credentials";
import Dashboard from "./views/Dashboard";
import Directory from "./views/Directory";
import Modules from "./views/Modules";
import Servers from "./views/Servers";
import Settings from "./views/Settings";
import Skills from "./views/Skills";
import Tokens from "./views/Tokens";

const VIEWS: Record<ViewKey, () => React.JSX.Element> = {
  dashboard: Dashboard,
  directory: Directory,
  connect: Connect,
  servers: Servers,
  tokens: Tokens,
  credentials: Credentials,
  modules: Modules,
  skills: Skills,
  settings: Settings,
};

function AppInner() {
  const { phase, view } = useStore();

  if (phase === "loading") {
    return <BootSkeleton />;
  }

  if (phase === "platform-off" || phase === "auth") {
    return <AuthView />;
  }

  const Active = VIEWS[view] || Dashboard;

  return (
    <AppShellLayout>
      <Active key={view} />
    </AppShellLayout>
  );
}

/** Loading state shaped like the dashboard itself — sizes match, no jump. */
function BootSkeleton() {
  return (
    <div className="min-h-dvh" style={{ background: "var(--color-background-body)" }}>
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-7 px-6 py-7">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-4 w-24" />
        </div>
        <div className="skeleton h-8 w-64" />
        <div className="metrics-rail" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3 p-[18px]">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-8 w-20" />
              <div className="skeleton h-[5px] w-full" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,2.1fr)_minmax(320px,0.9fr)]">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="skeleton h-10 w-full" style={{ opacity: 1 - i * 0.1 }} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-24 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastViewport position="bottomEnd" maxVisible={3} inset={{ bottom: 24, end: 24 }}>
        <AppInner />
        <ToastBridge />
      </ToastViewport>
    </StoreProvider>
  );
}
