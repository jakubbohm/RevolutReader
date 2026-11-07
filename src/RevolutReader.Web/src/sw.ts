// The app's service worker (c003 design.md D9): it keeps the build's files, so the app opens without network, and
// nothing else. No runtime caching: no API answer is ever kept here (Q10, ADR-0007).
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { SERVER_ONLY } from "./app/serverOnly";

declare let self: ServiceWorkerGlobalScope;

// A new version takes over as soon as it is installed, and the open page reloads once to show it (D9).
self.addEventListener("install", () => {
  void self.skipWaiting();
});
clientsClaim();

/** The app's page, precached with the build. */
const START_PAGE = "index.html";

// The precache list is written in at build time by vite-plugin-pwa; files of an older build are removed.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Every page address opens the app from the cache, as the server's page fallback does online (D5).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(START_PAGE), {
    denylist: SERVER_ONLY,
  }),
);
