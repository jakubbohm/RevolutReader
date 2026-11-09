// Vitest setup (c003 design.md § Bootstrap): Testing Library's DOM matchers, and a clean DOM after every test.
// The fake server and the recording address bar (c007, ./server.ts) go in here, before any module of the app loads:
// the API client takes `fetch` when its module loads, and jsdom does not navigate. So does the IntersectionObserver
// stand-in (c010, ./intersection.ts): jsdom has none.
// The phone's storage is `fake-indexeddb` (c009 design.md D4, D8), the real IndexedDB API in memory, emptied before
// every test (`emptyThePhone`); the test clock (./clock.ts) is stopped after every test.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { stopTestClock } from "./clock";
import {
  installIntersectionObserver,
  resetIntersectionObservers,
} from "./intersection";
import { emptyThePhone, installFakeServer, resetFakeServer } from "./server";

installFakeServer();
installIntersectionObserver();

beforeEach(async () => {
  await emptyThePhone();
});

afterEach(() => {
  // In this order: the app unmounts while the test clock still runs, so it clears its own timers on it.
  cleanup();
  resetFakeServer();
  resetIntersectionObservers();
  stopTestClock();
});
