import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const api = process.env.VITE_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@planner/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts") },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/uploads": { target: api, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2000 },
});
