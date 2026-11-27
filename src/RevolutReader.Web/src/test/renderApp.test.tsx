import { expect, test } from "vitest";
import { renderApp } from "./renderApp";

// The test kit's own checks: where `renderApp` opens the app (c019 design.md D12). A fragment of another kind than a
// balance's, which the app leaves alone (design.md D6), so only the kit is checked here.

test("The app opens at the address given, and its reopening from the icon at the start page", () => {
  const app = renderApp("iPhone Home Screen", {}, { address: "/#somewhere" });

  expect(app.address()).toBe("/#somewhere");
  expect(location.hash).toBe("#somewhere");

  app.reopen();

  expect(app.address()).toBe("/");
  expect(location.hash).toBe("");
});

test("Without an address, the app opens at its start page", () => {
  const app = renderApp("iPhone Home Screen");

  expect(app.address()).toBe("/");
});
