// Builds the desktop window UI as plain static files for Electron (file:// needs base "./").
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "electron/renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: path.resolve(__dirname, "dist-electron/renderer"), emptyOutDir: true },
});
