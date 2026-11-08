import { expect, test } from "vitest";
import type { Balance } from "./balance";
import { shown, type Facts } from "./screenState";

// What the account screen shows, from what it knows (c009 design.md D2, the phases of the first load; D7, the list slot
// under the header): plain values in, the screen out. The balance and the user are made up.

const LUCIE = {
  kind: "signed-in",
  name: "Lucie Nováková",
  email: "lucie@example.com",
} as const;

const READ: Balance = {
  amount: 286.4,
  readAt: "2026-11-10T08:58:00+00:00",
  czkPerEur: 24.3,
};

/** The facts at the very start, before any answer and with nothing stored, changed by `changes`. */
function facts(changes: Partial<Facts>): Facts {
  return {
    session: "waiting",
    stored: null,
    balance: null,
    reading: "no",
    wait: "short",
    wokeUp: false,
    problem: null,
    signingOut: false,
    ...changes,
  };
}

test("Before any answer, with nothing stored, the account screen is empty and has no menu", () => {
  expect(shown(facts({}))).toEqual({
    screen: "account",
    account: null,
    header: null,
    banner: null,
    body: "empty",
    signingOut: false,
  });
});

test("A signed-in user with a read balance gets the header, the menu and the list slot", () => {
  expect(shown(facts({ session: LUCIE, balance: READ }))).toEqual({
    screen: "account",
    account: { name: "Lucie Nováková", email: "lucie@example.com" },
    header: { balance: READ, refreshing: false },
    banner: null,
    body: "list",
    signingOut: false,
  });
});

test("A first read on an awake server, with nothing stored, shows the balance placeholder", () => {
  expect(
    shown(facts({ session: LUCIE, reading: "first", wait: "short" })),
  ).toMatchObject({ screen: "account", header: "placeholder" });
});

const STORED: Balance = {
  amount: 250,
  readAt: "2026-11-10T07:00:00+00:00",
  czkPerEur: 24.3,
};

const refreshing: {
  label: string;
  changes: Partial<Facts>;
  header: Balance;
}[] = [
  {
    label: "a refresh over a read balance",
    changes: { session: LUCIE, balance: READ, reading: "refresh" },
    header: READ,
  },
  {
    // D2: once the server answered within 1.5 s, the stored header reads "Obnovuji…" while the balance is read.
    label: "the first read on an awake server, over a stored balance",
    changes: {
      session: LUCIE,
      stored: STORED,
      balance: STORED,
      reading: "first",
      wait: "short",
      wokeUp: false,
    },
    header: STORED,
  },
];

test.each(refreshing)(
  "While a refresh reads, the header shows the balance in its refreshing state: $label",
  ({ changes, header }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      header: { balance: header, refreshing: true },
    });
  },
);

// D2's offline rules and app-shell's offline requirement: with nothing stored, the offline state is the whole screen
// under the top bar, whichever request found the phone offline, and whether the offline problem is also on record.
const offlineWithNothingStored: { label: string; changes: Partial<Facts> }[] = [
  {
    label: "who is signed in found the phone offline",
    changes: { session: { kind: "offline" } },
  },
  {
    label: "who is signed in found the phone offline, the problem on record",
    changes: { session: { kind: "offline" }, problem: { kind: "offline" } },
  },
  {
    label: "the first balance read found the phone offline",
    changes: { session: LUCIE, problem: { kind: "offline" } },
  },
];

test.each(offlineWithNothingStored)(
  "Offline with nothing stored, the whole screen says so, with no header and no banner: $label",
  ({ changes }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      header: null,
      banner: null,
      body: "offline",
    });
  },
);
