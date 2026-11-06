import { expect, test } from "vitest";
import { needsInstallHint } from "./device";

/** Safari on an iPhone. */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

/** Chrome on an iPhone: Apple's engine under Chrome's name (CriOS). */
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1";

/** An app's built-in browser on an iPhone (a web view, as in a mail or social app): no Safari version in it. */
const IPHONE_IN_APP_BROWSER =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/** Safari on an iPad: iPadOS reports itself as a Mac. */
const IPAD_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/** Chrome on an Android phone. */
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

/** Chrome on a Windows computer. */
const COMPUTER_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

test("An iPhone Safari tab needs the install hint", () => {
  expect(
    needsInstallHint({ userAgent: IPHONE_SAFARI, standalone: false }),
  ).toBe(true);
});

test("Another browser tab on an iPhone needs the install hint too", () => {
  expect(
    needsInstallHint({ userAgent: IPHONE_CHROME, standalone: false }),
  ).toBe(true);
  expect(
    needsInstallHint({ userAgent: IPHONE_IN_APP_BROWSER, standalone: false }),
  ).toBe(true);
});

test("The app opened from the Home Screen needs no install hint", () => {
  expect(needsInstallHint({ userAgent: IPHONE_SAFARI, standalone: true })).toBe(
    false,
  );
});

test("An iPad, an Android phone or a computer needs no install hint", () => {
  expect(needsInstallHint({ userAgent: IPAD_SAFARI, standalone: false })).toBe(
    false,
  );
  expect(
    needsInstallHint({ userAgent: ANDROID_CHROME, standalone: false }),
  ).toBe(false);
  expect(
    needsInstallHint({ userAgent: COMPUTER_CHROME, standalone: false }),
  ).toBe(false);
});
