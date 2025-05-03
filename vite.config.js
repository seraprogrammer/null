import { defineConfig } from "vite";
import olovaPlugin from "./vite-plugin-olova";

export default defineConfig({
  plugins: [olovaPlugin()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
