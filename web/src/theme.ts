import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

const KEY = "mcw-theme";
const listeners = new Set<() => void>();

function read(): ThemeMode {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

let current: ThemeMode = read();
document.documentElement.dataset.theme = current;

function getThemeMode(): ThemeMode {
  return current;
}

export function setThemeMode(mode: ThemeMode): void {
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode — session-only toggle */
  }
  document.documentElement.dataset.theme = mode;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
}
