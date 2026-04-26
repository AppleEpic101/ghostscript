import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";

const isWatchMode = process.argv.includes("--watch");
const rootDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(rootDir, "..");
const browserDefines = {
  "process.env.NODE_ENV": JSON.stringify("production"),
};

const sharedConfig = {
  configFile: false,
  root: extensionRoot,
  base: "./",
  define: browserDefines,
  plugins: [react()],
};

const watchConfig = isWatchMode ? {} : null;

await build(
  mergeConfig(sharedConfig, {
    build: {
      outDir: "dist",
      emptyOutDir: true,
      watch: watchConfig,
      rollupOptions: {
        input: {
          popup: resolve(extensionRoot, "popup.html"),
          background: resolve(extensionRoot, "src/background/index.ts"),
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  }),
);

await build(
  mergeConfig(sharedConfig, {
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      watch: watchConfig,
      lib: {
        entry: resolve(extensionRoot, "src/content/main.tsx"),
        formats: ["iife"],
        name: "GhostscriptContentScript",
        fileName: () => "assets/content.js",
      },
      rollupOptions: {
        output: {
          assetFileNames: "assets/[name]-[hash][extname]",
          inlineDynamicImports: true,
        },
      },
    },
  }),
);
