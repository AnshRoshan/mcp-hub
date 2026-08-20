import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * MCP Workstation web app.
 *
 * - `vite` (dev)        → serves the app on :5173, proxying /api and /mcp to
 *                         the backend port from the root .env.
 * - `vite build`        → emits the production bundle into ../public so the
 *                         existing Node backend serves it unchanged.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  const backend = `http://localhost:${env.PORT || "3000"}`;
  return {
    root: import.meta.dirname,
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": backend,
        "/mcp": backend,
      },
    },
    build: {
      outDir: path.resolve(import.meta.dirname, "..", "public"),
      emptyOutDir: true,
      // The Astryx design system is a single large lib — its chunk is expected.
      chunkSizeWarningLimit: 700,
      // Split the heavy libs so the initial HTML/JS paints fast and caching
      // keeps them out of future rebuilds.
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules/@astryxdesign") || id.includes("node_modules/@stylexjs")) return "astryx";
            if (id.includes("node_modules/react")) return "react";
          },
        },
      },
    },
    publicDir: false,
  };
});
