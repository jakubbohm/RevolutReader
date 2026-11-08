// Vitest setup (c003 design.md § Bootstrap): Testing Library's DOM matchers, and a clean DOM after every test.
// The fake server and the recording address bar (c007, ./server.ts) go in here, before any module of the app loads:
// the API client takes `fetch` when its module loads, and jsdom does not navigate.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installFakeServer, resetFakeServer } from "./server";

installFakeServer();

afterEach(() => {
  cleanup();
  resetFakeServer();
});
