import { expect, test } from "vitest";
import {
  MINUTE,
  SECOND,
  startTestClock,
  timePasses,
  userOnTheTestClock,
} from "../test/clock";
import { goOffline, leaveApp, returnToApp } from "../test/server";
import { keepServerAwake } from "./keepAwake";

// Keeping the server awake while the app is on screen (c009 design.md D9): the health check is asked on coming on screen
// and every 4 minutes while on screen, nothing while off screen or offline; after 30 minutes without a tap or key press
// it stops, and the next one asks at once and starts the rhythm again. On the test clock, with the test's own page
// (jsdom) turned hidden and visible by the kit; each test counts the asks in a plain function and stops the watch.

test("Coming on screen asks the health check at once", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  try {
    await timePasses(0);

    expect(asks).toBe(1);
  } finally {
    stop();
  }
});

test("On screen, it asks again every 4 minutes", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  try {
    await timePasses(4 * MINUTE - SECOND);
    expect(asks, "before 4 minutes").toBe(1);
    await timePasses(SECOND);
    expect(asks, "at 4 minutes").toBe(2);
    await timePasses(4 * MINUTE);
    expect(asks, "at 8 minutes").toBe(3);
  } finally {
    stop();
  }
});

test("Off screen, it asks nothing, and asks at once on coming back", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  try {
    await timePasses(0);
    leaveApp();
    await timePasses(10 * MINUTE);
    expect(asks, "off screen").toBe(1);

    returnToApp();
    await timePasses(0);

    expect(asks, "on coming back").toBe(2);
  } finally {
    stop();
  }
});

test("With the phone offline, it asks nothing", async () => {
  startTestClock();
  goOffline();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  try {
    await timePasses(10 * MINUTE);
    leaveApp();
    returnToApp();
    await timePasses(0);

    expect(asks).toBe(0);
  } finally {
    stop();
  }
});

test("After the stop function, it asks nothing", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  await timePasses(0);
  const user = userOnTheTestClock();

  stop();
  await timePasses(10 * MINUTE);
  leaveApp();
  returnToApp();
  await user.click(document.body);
  await user.keyboard("a");
  await timePasses(0);

  expect(asks).toBe(1);
});

test("After 30 minutes without a tap or key press, it stops asking", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  try {
    await timePasses(28 * MINUTE);
    expect(asks, "at 0, 4, … and 28 minutes").toBe(8);

    await timePasses(12 * MINUTE);

    expect(asks, "none after 28 minutes").toBe(8);
  } finally {
    stop();
  }
});

test("A tap after the stop asks at once and starts the 4-minute rhythm again", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  const user = userOnTheTestClock();
  try {
    await timePasses(40 * MINUTE);
    expect(asks, "stopped after the one at 28 minutes").toBe(8);

    await user.click(document.body);
    await timePasses(0);
    expect(asks, "at once").toBe(9);
    await timePasses(4 * MINUTE - SECOND);
    expect(asks, "before 4 minutes more").toBe(9);
    await timePasses(SECOND);
    expect(asks, "4 minutes after the tap").toBe(10);
  } finally {
    stop();
  }
});

test("A key press counts as use, like a tap", async () => {
  startTestClock();
  let asks = 0;
  const stop = keepServerAwake(() => {
    asks += 1;
  });
  const user = userOnTheTestClock();
  try {
    await timePasses(40 * MINUTE);
    expect(asks, "stopped after the one at 28 minutes").toBe(8);

    await user.keyboard("a");
    await timePasses(0);

    expect(asks, "at once").toBe(9);
  } finally {
    stop();
  }
});
