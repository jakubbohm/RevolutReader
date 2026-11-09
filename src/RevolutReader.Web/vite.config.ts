import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

/**
 * The API's address when Aspire runs the dev server: `WithReference(api)` in the AppHost sets API_HTTPS and API_HTTP
 * (D11). Outside Aspire neither is set, and the dev server forwards nothing.
 */
const apiAddress = process.env.API_HTTPS ?? process.env.API_HTTP;

/** How the dev server forwards a path to the API (below). */
const toTheApi = apiAddress
  ? { target: apiAddress, changeOrigin: false, secure: false, xfwd: true }
  : undefined;

// https://vite.dev/config/ — c003 design.md D1
export default defineConfig({
  // The browser talks to the dev server only, which forwards /api to the API. `secure: false` accepts the local
  // development certificate. The API sees the request as the browser sent it, as behind the hosting proxy in production
  // (c007 design.md D2, D10): `xfwd: true` sends X-Forwarded-Proto and X-Forwarded-For, so the scheme is the browser's
  // https whichever address the dev server targets, and `changeOrigin: false` keeps the Host header, so the host is the
  // dev server's localhost:<port>. The sign-in's return address is then https://localhost:<port>/api/auth/signin-oidc,
  // and a write's Origin matches the API's own origin. Aspire adds the dev server's HTTPS certificate itself
  // (WithHttpsDeveloperCertificate in the AppHost). /health goes the same way, for the keep-alive (c009 design.md D9).
  server: toTheApi
    ? { proxy: { "/api": toTheApi, "/health": toTheApi } }
    : undefined,
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
