import { Spinner } from "@astryxdesign/core/Spinner";
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
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" label="Loading workstation…" />
      </div>
    );
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
