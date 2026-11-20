import { expect, test } from "vitest";
import { goOffline, goOnline, leaveApp, returnToApp } from "../test/server";
import { watchRefreshTriggers, watchReturns } from "./refreshTriggers";

// What asks the screen for a refresh (c009 design.md D3, D7 b): coming back to it, every time, and coming back online;
// leaving asks for nothing, and after the stop function nothing does. The page and the window are the test's own
// (jsdom); the kit's `leaveApp` and `returnToApp` turn the page hidden and visible, and `goOffline` and `goOnline` the
// network off and on, as the phone does. Each test counts the asks in a plain function.

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

test("Coming back online asks for a refresh", () => {
  let asked = 0;
  const stop = watchRefreshTriggers(() => {
    asked += 1;
  });

  goOffline();
  goOnline();

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

// ---- c013: returns alone (design.md D1) ----
// A return to the screen is an opening, and starts the upkeep of the phone's push subscription; coming back online and
// "Obnovit" are none. `watchReturns` calls back on the page's `visibilitychange` to `visible` alone, every time. As
// above, the kit turns the page and the network, and each test counts the returns in a plain function.

/** A page of the test's own, given instead of the document: visible until the test turns it. */
function aPageOfItsOwn(): {
  page: Document;
  turn: (state: DocumentVisibilityState) => void;
} {
  const page = new EventTarget();
  let visibility: DocumentVisibilityState = "visible";
  Object.defineProperty(page, "visibilityState", { get: () => visibility });
  return {
    page: page as unknown as Document,
    turn: (state) => {
      visibility = state;
      page.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

// ---- 8.1 ----

test("A return to the screen calls back, every time", () => {
  let returns = 0;
  const stop = watchReturns(() => {
    returns += 1;
  });

  leaveApp();
  returnToApp();
  leaveApp();
  returnToApp();

  expect(returns).toBe(2);
  stop();
});

test("A return to the screen calls back, every time: on the page given, not the document", () => {
  let returns = 0;
  const own = aPageOfItsOwn();
  const stop = watchReturns(() => {
    returns += 1;
  }, own.page);

  leaveApp();
  returnToApp();
  expect(returns, "the document's return is not its own").toBe(0);

  own.turn("hidden");
  own.turn("visible");
  expect(returns, "its own page's return").toBe(1);
  stop();
});

// ---- 8.2 ----

test("Leaving the screen and coming back online call nothing", () => {
  let returns = 0;
  const stop = watchReturns(() => {
    returns += 1;
  });

  leaveApp();
  goOffline();
  goOnline();

  expect(returns).toBe(0);
  stop();
});

// ---- 8.3 ----

test("The stop function ends the watch", () => {
  let returns = 0;
  const stop = watchReturns(() => {
    returns += 1;
  });

  stop();
  leaveApp();
  returnToApp();

  expect(returns).toBe(0);
});

test("The stop function ends the watch: only its own, another watch on the page goes on", () => {
  let stoppedReturns = 0;
  let otherReturns = 0;
  const stop = watchReturns(() => {
    stoppedReturns += 1;
  });
  const stopOther = watchReturns(() => {
    otherReturns += 1;
  });

  stop();
  leaveApp();
  returnToApp();

  expect(stoppedReturns, "the stopped watch").toBe(0);
  expect(otherReturns, "the other watch").toBe(1);
  stopOther();
});
