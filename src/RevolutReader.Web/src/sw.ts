// The app's service worker (c003 design.md D9): it keeps the build's files, so the app opens without network. Its
// caches hold only those files, never an API answer (Q10, ADR-0007 item 1). It shows the app's pushes
// (c012 design.md D9) and keeps the balance a push brings, in its page's fragment and checked with the worker's own
// push subscription, by the rule the page keeps one by, in the app's IndexedDB record (ADR-0007 item 3; c015 design.md
// D3, D4; c019 design.md D7).
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { listenForPushes } from "./app/pushDisplay";
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

// A push shows as a notification, and its balance, checked with this worker's subscription (c019 design.md D7),
// replaces the kept one by c015's rule (c015 design.md D3); a tap on the notification opens the app (c012 design.md D9).
listenForPushes(self);
