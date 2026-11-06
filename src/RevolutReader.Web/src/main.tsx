import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { readDevice } from "./app/device";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App device={readDevice(window)} />
  </StrictMode>,
);

// The service worker keeps the app's files, so it opens without network (c003 design.md D9).
registerSW({ immediate: true });
