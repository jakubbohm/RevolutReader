import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import {
  readRecord,
  recordNotifications,
  type NotificationLike,
  type RecordedPage,
} from "../app/notificationTestRecord";
import { realTurn } from "../test/clock";
import { timeline } from "../test/server";
import { NotificationTestScreen } from "./NotificationTestScreen";

// Temporary, for the iPhone test of #113 (reverted with it). Every value here is made up.

const TEST_NOTIFICATION: NotificationLike = {
  title: "Test 2",
  body: "Vymyšlený zůstatek",
  data: {
    test: {
      amount: 102.02,
      readAt: "2026-11-26T14:05:00+00:00",
      czkPerEur: 25.5,
    },
  },
};

const BALANCE_NOTIFICATION: NotificationLike = {
  title: "Odešlo 3,80 €",
  body: "Zůstatek 282,60 € (≈ 6 867 Kč)",
  data: { balance: { amount: 282.6 } },
};

/**
 * The page the record runs on, as main.tsx starts it on `window`: this window's own storage and events, so the test page
 * hears its changes; the address, the visibility and the notifications stood in for.
 */
function windowAt(
  path: string,
  fragment: string,
  notifications: readonly NotificationLike[],
): RecordedPage {
  return {
    location: { pathname: path, hash: fragment },
    document: {
      visibilityState: "visible",
      addEventListener: () => {},
    },
    navigator: {
      serviceWorker: {
        ready: Promise.resolve({
          getNotifications: () => Promise.resolve(notifications),
        }),
      },
    },
    performance: { getEntriesByType: () => [{ type: "navigate" }] },
    localStorage: globalThis.localStorage,
    addEventListener: () => {},
    dispatchEvent: (event) => window.dispatchEvent(event),
  };
}

/** Starts the record on such a page and lets it complete, as the app's start does. */
async function appStarts(
  path: string,
  fragment: string,
  notifications: readonly NotificationLike[],
): Promise<void> {
  await act(async () => {
    recordNotifications(windowAt(path, fragment, notifications));
    await realTurn();
    await realTurn();
  });
}

test("The test page shows the record, the newest first, each test notification in full and every other one counted", async () => {
  await appStarts("/", "", [BALANCE_NOTIFICATION]);
  await appStarts("/test/notifications", "#t2", [
    TEST_NOTIFICATION,
    BALANCE_NOTIFICATION,
  ]);

  render(<NotificationTestScreen />);

  const entries = screen.getAllByRole("listitem");
  expect(entries).toHaveLength(2);
  expect(entries[0]).toHaveTextContent("#2 spuštění");
  expect(entries[0]).toHaveTextContent("/test/notifications#t2");
  expect(entries[0]).toHaveTextContent("1 zkušební, 1 jiné");
  expect(entries[0]).toHaveTextContent(
    'Test 2 · Vymyšlený zůstatek · {"amount":102.02,"readAt":"2026-11-26T14:05:00+00:00","czkPerEur":25.5}',
  );
  expect(entries[1]).toHaveTextContent("#1 spuštění");
  expect(entries[1]).toHaveTextContent("/ (bez #)");
  expect(entries[1]).toHaveTextContent("0 zkušební, 1 jiné");
  expect(document.body).not.toHaveTextContent("Odešlo");
  expect(document.body).not.toHaveTextContent("282");
});

test("The test page sends no request at all: no bank read, no API, no health check", async () => {
  await appStarts("/test/notifications", "#t1", [TEST_NOTIFICATION]);

  render(<NotificationTestScreen />);
  await act(async () => {
    await realTurn();
    await realTurn();
  });

  expect(timeline()).toEqual([]);
});

test("An entry recorded while the test page is open shows at once", async () => {
  await appStarts("/test/notifications", "#t1", []);
  render(<NotificationTestScreen />);

  // A later event of the same open page, as a tap that changes only the fragment.
  await appStarts("/test/notifications", "#t2", [TEST_NOTIFICATION]);

  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
    "/test/notifications#t2",
  );
});

test("Clearing the record empties it on the page and in the phone's storage", async () => {
  await appStarts("/test/notifications", "#t1", [TEST_NOTIFICATION]);
  render(<NotificationTestScreen />);

  await userEvent.click(screen.getByRole("button", { name: "Smazat záznam" }));

  expect(screen.queryAllByRole("listitem")).toEqual([]);
  expect(screen.getByText("Záznam je prázdný.")).toBeInTheDocument();
  expect(readRecord(localStorage)).toEqual([]);
});
