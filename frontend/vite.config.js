import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  publicDir: resolve(root, "public"),
  server: {
    host: "localhost",
    port: 5500,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:5080"
    }
  },
  build: {
    outDir: resolve(root, "wwwroot"),
    emptyOutDir: true
  },
  test: {
    environment: "jsdom"
  }
});
