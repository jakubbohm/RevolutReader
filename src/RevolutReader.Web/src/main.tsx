import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { readDevice } from "./app/device";
import {
  isNotificationTestPage,
  recordNotifications,
} from "./app/notificationTestRecord";
import { watchForUpdates } from "./app/updates";
import { NotificationTestScreen } from "./screens/NotificationTestScreen";

// Temporary, for the iPhone test of #113 (reverted with it): the record of the phone's notifications starts first, at
// every start, before anything renders; its test page, at an address nothing links to, shows instead of the app there.
recordNotifications(window);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isNotificationTestPage(location.pathname) ? (
      <NotificationTestScreen />
    ) : (
      <App device={readDevice(window)} />
    )}
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
