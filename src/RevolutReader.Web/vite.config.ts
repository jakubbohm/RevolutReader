import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/ — c003 design.md D1
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Our own service worker, src/sw.ts, built with the precache list written in (D9). Off in the dev server.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      // A new version takes over at once; the page reloads once when it does.
      registerType: "autoUpdate",
      // The Home Screen app: name, colours and icons from the design system's App icon guideline (D10).
      manifest: {
        name: "Tarjeta Papá",
        short_name: "Tarjeta Papá",
        lang: "cs",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#f6f4ef",
        background_color: "#f6f4ef",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // The icons come in through the root PNG pattern below, so they aren't listed twice. The plugin adds the
      // manifest itself, so the patterns leave it out.
      includeManifestIcons: false,
      injectManifest: {
        // The build's code, styles and page, and the SVG and PNG icons at the root. Never the launch images in
        // launch/, which iOS reads itself (D10).
        globPatterns: ["**/*.{js,css,html}", "*.{svg,png}"],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
});
