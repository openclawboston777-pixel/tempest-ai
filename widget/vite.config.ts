import { defineConfig } from "vite";

export default defineConfig({
  build: {
    cssCodeSplit: false,
    lib: {
      entry: "src/widget.ts",
      formats: ["iife"],
      name: "TempestWidget",
      fileName: () => "tempest-widget.iife.js"
    },
    outDir: "dist",
    emptyOutDir: true
  }
});
