import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import App from "./App";
import { useThemeMode } from "./theme";
import "./index.css";

function Root() {
  const mode = useThemeMode();
  return (
    <StrictMode>
      <Theme theme={neutralTheme} mode={mode}>
        <App />
      </Theme>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
