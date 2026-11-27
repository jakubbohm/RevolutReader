import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { readDevice } from "./app/device";
import { removeSpikeLeftovers } from "./app/leftovers";
import { watchForUpdates } from "./app/updates";

// Before anything else of the screen, what earlier work left on the phone goes (c019 design.md D11).
removeSpikeLeftovers();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App device={readDevice(window)} />
  </StrictMode>,
);

// The service worker keeps the app's files, so it opens without network, and a new version shows on the next open
// (c003 design.md D9): the browser checks on a fresh open, and the watch checks whenever the app returns to the screen.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) watchForUpdates(registration, document, navigator);
  },
});
