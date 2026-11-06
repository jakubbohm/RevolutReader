import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { readDevice } from "./app/device";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App device={readDevice(window)} />
  </StrictMode>,
);
