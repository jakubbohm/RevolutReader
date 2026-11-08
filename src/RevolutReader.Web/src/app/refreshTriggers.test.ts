import { expect, test } from "vitest";
import { goOffline, goOnline, leaveApp, returnToApp } from "../test/server";
import { watchRefreshTriggers } from "./refreshTriggers";

// What asks the screen for a refresh (c009 design.md D3, D7 b): coming back to it, every time; leaving asks for nothing,
// and after the stop function nothing does. The page and the window are the test's own (jsdom); the kit's `leaveApp` and
// `returnToApp` turn the page hidden and visible, as the phone does. Each test counts the asks in a plain function.

test("Coming back to the screen asks for a refresh", () => {
  let asked = 0;
  const stop = watchRefreshTriggers(() => {
    asked += 1;
  });

  leaveApp();
  returnToApp();

  expect(asked).toBe(1);
  stop();
});

test("Leaving the screen asks for nothing", () => {
  let asked = 0;
  const stop = watchRefreshTriggers(() => {
    asked += 1;
  });

  leaveApp();

  expect(asked).toBe(0);
  stop();
});

test("After the stop function, nothing asks for a refresh", () => {
  let asked = 0;
  const stop = watchRefreshTriggers(() => {
    asked += 1;
  });

  stop();
  leaveApp();
  returnToApp();
  goOffline();
  goOnline();

  expect(asked).toBe(0);
});
