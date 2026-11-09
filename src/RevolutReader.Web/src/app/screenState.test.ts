import { expect, test } from "vitest";
import type { Balance } from "./balance";
import type { ListProblem } from "./listState";
import {
  OFFLINE,
  shown,
  type Facts,
  type ListReport,
  type Problem,
  type Shown,
} from "./screenState";

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

/**
 * The facts at the very start, before any answer and with nothing stored, changed by `changes`; the list idle, with no
 * problem and nothing on screen (`listReport`).
 */
function facts(changes: Partial<Facts>): Facts {
  return {
    session: "waiting",
    balance: null,
    reading: "no",
    wait: "short",
    wokeUp: false,
    problem: null,
    signingOut: false,
    list: listReport({}),
    ...changes,
  };
}

/** What the list reports (c010 design.md D8), changed by `changes`: by default idle, with no problem, nothing on screen yet. */
function listReport(changes: Partial<ListReport>): ListReport {
  return { reading: false, problem: null, onScreen: false, ...changes };
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

// D2 and D7 (a): with a stored balance, offline is its header, the "Jsi offline" banner, and the note in the list's
// place, whichever request found the phone offline.
const offlineWithAStoredBalance = offlineWithNothingStored.map(
  ({ label, changes }) => ({
    label,
    changes: { ...changes, balance: STORED },
  }),
);

test.each(offlineWithAStoredBalance)(
  "Offline with a stored balance, the screen shows its header, the offline banner and the note in the list's place: $label",
  ({ changes }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      header: { balance: STORED, refreshing: false },
      banner: { kind: "offline" },
      body: "offline note",
    });
  },
);

// D2's phases of the first load, while who is signed in has no answer yet: under 1.5 s, from 1.5 s; and after a wake
// (the first answer took 1.5 s or more), until the balance arrives. The list slot (D7 a) is `body: "list"`: in C7a it
// holds nothing, and C7b's list goes there.

test("Under 1.5 s with a stored balance, the header shows it in its default state and the list slot is empty", () => {
  expect(shown(facts({ balance: STORED, wait: "short" }))).toMatchObject({
    screen: "account",
    header: { balance: STORED, refreshing: false },
    banner: null,
    body: "list",
  });
});

test("From 1.5 s with a stored balance, the waking-up screen stands in the list's place", () => {
  expect(shown(facts({ balance: STORED, wait: "long" }))).toMatchObject({
    screen: "account",
    header: { balance: STORED, refreshing: false },
    body: "waking",
  });
});

test("From 1.5 s with nothing stored, the waking-up screen is the whole screen", () => {
  expect(shown(facts({ wait: "long" }))).toMatchObject({
    screen: "account",
    header: null,
    banner: null,
    body: "waking",
  });
});

const slowWakes: { label: string; changes: Partial<Facts>; shows: object }[] = [
  {
    label: "a balance stored, in the list's place",
    changes: { balance: STORED, wait: "slow" },
    shows: { header: { balance: STORED, refreshing: false } },
  },
  {
    label: "nothing stored, the whole screen",
    changes: { wait: "slow" },
    shows: { header: null, banner: null },
  },
];

test.each(slowWakes)(
  "From 30 s, the waking-up screen is the slow one: $label",
  ({ changes, shows }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      ...shows,
      body: "waking slow",
    });
  },
);

const afterAWake: { label: string; changes: Partial<Facts>; shows: object }[] =
  [
    {
      label: "the balance read runs, nothing stored",
      changes: { session: LUCIE, reading: "first", wait: "long", wokeUp: true },
      shows: { header: null, body: "waking" },
    },
    {
      label: "the balance read runs, a balance stored",
      changes: {
        session: LUCIE,
        balance: STORED,
        reading: "first",
        wait: "long",
        wokeUp: true,
      },
      shows: { header: { balance: STORED, refreshing: false }, body: "waking" },
    },
    {
      label: "the balance has arrived",
      changes: { session: LUCIE, balance: READ, wait: "long", wokeUp: true },
      shows: { header: { balance: READ, refreshing: false }, body: "list" },
    },
  ];

test.each(afterAWake)(
  "After a wake, the waking-up screen stays until the balance arrives, never a placeholder: $label",
  ({ changes, shows }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      ...shows,
    });
  },
);

// D5 (a): a bank failure with nothing to show is its banner, standing alone under the top bar: no header, and no
// whole-screen state beside it (the empty frame's body), also once a wake is over.
const bankFailuresWithNothingToShow: {
  label: string;
  problem: Problem;
  changes: Partial<Facts>;
}[] = [
  {
    label: "the bank does not answer",
    problem: { kind: "bank unavailable" },
    changes: {},
  },
  {
    label: "the bank's limit is reached",
    problem: { kind: "bank rate limited" },
    changes: {},
  },
  {
    label: "the bank's access has expired",
    problem: { kind: "bank access expired" },
    changes: {},
  },
  {
    label: "the bank's access has expired, after a wake",
    problem: { kind: "bank access expired" },
    changes: { wait: "long", wokeUp: true },
  },
];

test.each(bankFailuresWithNothingToShow)(
  "A bank failure with no balance to show gives the banner alone, without the header: $label",
  ({ problem, changes }) => {
    expect(shown(facts({ session: LUCIE, problem, ...changes }))).toMatchObject(
      {
        screen: "account",
        header: null,
        banner: problem,
        body: "empty",
      },
    );
  },
);

// D2, D5 (b), spec app-shell: an unexpected answer to who is signed in is the error banner, below a stored balance if
// there is one, and no menu (the server named nobody), whether or not the problem is also on record.
const unexpectedAnswers: {
  label: string;
  changes: Partial<Facts>;
  shows: object;
}[] = [
  {
    label: "nothing stored",
    changes: {},
    shows: { header: null, body: "empty" },
  },
  {
    label: "nothing stored, the problem on record",
    changes: { problem: { kind: "unexpected" } },
    shows: { header: null, body: "empty" },
  },
  {
    label: "a balance stored",
    changes: { balance: STORED },
    shows: { header: { balance: STORED, refreshing: false } },
  },
  {
    label: "a balance stored, the problem on record",
    changes: {
      balance: STORED,
      problem: { kind: "unexpected" },
    },
    shows: { header: { balance: STORED, refreshing: false } },
  },
];

test.each(unexpectedAnswers)(
  "An unexpected answer to who is signed in gives the error banner, below a stored balance if there is one, and no menu: $label",
  ({ changes, shows }) => {
    expect(
      shown(facts({ session: { kind: "unexpected" }, ...changes })),
    ).toMatchObject({
      screen: "account",
      account: null,
      banner: { kind: "unexpected" },
      ...shows,
    });
  },
);

// ---- c010: the join with the list (c010 design.md D8) ----
// The list reports to the screen whether its newest page is being read, the problem its last one left, and whether a
// newest page has come (`ListReport`). One banner by precedence: offline; expired access; the request limit; the bank
// not answering; the balance's unexpected answer; the list's unexpected answer. A problem of the list's read alone is
// worded as the list's (`of: "list"`: "Pohyby se nepodařilo načíst"); without it, C7a's words.

/** Lucie with her balance read, the balance's problem and the list's as given, a list on screen. */
function withProblems(
  balanceProblem: Problem | null,
  listProblem: ListProblem | null,
): Facts {
  return facts({
    session: LUCIE,
    balance: READ,
    problem: balanceProblem,
    list: listReport({ problem: listProblem, onScreen: true }),
  });
}

const EXPIRED = { kind: "bank access expired" } as const;
const LIMIT = { kind: "bank rate limited" } as const;
const BANK_DOWN = { kind: "bank unavailable" } as const;
const UNEXPECTED = { kind: "unexpected" } as const;
const LIST_OFFLINE = { kind: "offline" } as const;

const precedence: {
  label: string;
  checks: {
    balance: Problem | null;
    list: ListProblem | null;
    banner: Problem;
  }[];
}[] = [
  {
    label: "offline over expired access, whichever read has it",
    checks: [
      { balance: OFFLINE, list: EXPIRED, banner: OFFLINE },
      { balance: EXPIRED, list: LIST_OFFLINE, banner: OFFLINE },
    ],
  },
  {
    label: "expired access over the request limit, whichever read has it",
    checks: [
      { balance: EXPIRED, list: LIMIT, banner: EXPIRED },
      { balance: LIMIT, list: EXPIRED, banner: EXPIRED },
    ],
  },
  {
    label:
      "the request limit over the bank not answering, whichever read has it",
    checks: [
      { balance: LIMIT, list: BANK_DOWN, banner: LIMIT },
      { balance: BANK_DOWN, list: LIMIT, banner: LIMIT },
    ],
  },
  {
    label:
      "the bank not answering over an unexpected answer, whichever read has it",
    checks: [
      // The balance's words: only its read failed at the bank.
      { balance: BANK_DOWN, list: UNEXPECTED, banner: BANK_DOWN },
      // Either wording: only the precedence is claimed here.
      {
        balance: UNEXPECTED,
        list: BANK_DOWN,
        banner: expect.objectContaining(BANK_DOWN) as Problem,
      },
    ],
  },
  {
    label:
      "the balance's unexpected answer over the list's, which shows when nothing else does",
    checks: [
      { balance: UNEXPECTED, list: UNEXPECTED, banner: UNEXPECTED },
      {
        balance: null,
        list: UNEXPECTED,
        banner: { ...UNEXPECTED, of: "list" },
      },
    ],
  },
];

test.each(precedence)(
  "The banner shows the most important problem: $label",
  ({ checks }) => {
    for (const { balance, list, banner } of checks)
      expect(
        bannerOf(shown(withProblems(balance, list))),
        `the balance's ${balance?.kind ?? "none"}, the list's ${list?.kind ?? "none"}`,
      ).toEqual(banner);
  },
);

test('Both reads failing at the bank show "Banka teď neodpovídá"; the list alone failing shows "Pohyby se nepodařilo načíst"', () => {
  // The scenario's fresh start: nothing stored, and the bank answers neither read.
  const bothFailed = facts({
    session: LUCIE,
    problem: BANK_DOWN,
    list: listReport({ problem: BANK_DOWN }),
  });
  expect(bannerOf(shown(bothFailed)), "both failed: C7a's words").toEqual(
    BANK_DOWN,
  );

  expect(
    bannerOf(shown(withProblems(null, BANK_DOWN))),
    "the list alone: the list's words",
  ).toEqual({ ...BANK_DOWN, of: "list" });
});

// c009 design.md D6: a failed sign-out's banner replaces any other until the next action, which clears it the moment
// it starts (C7a's sequence); the list's problems rank below it.
const listProblems: ListProblem[] = [
  LIST_OFFLINE,
  EXPIRED,
  LIMIT,
  BANK_DOWN,
  UNEXPECTED,
];

test.each(listProblems)(
  "A failed sign-out stays above the list's problem until the next action: $kind",
  (listProblem) => {
    const signOutFailed: Problem = { kind: "sign-out failed", offline: false };

    expect(bannerOf(shown(withProblems(signOutFailed, listProblem)))).toEqual(
      signOutFailed,
    );
  },
);

// D8: "Obnovuji…" waits for both answers, on a refresh and on the first load on an awake server alike; the balance's
// read alone is C7a's (above).
const listReads: { label: string; list: ListReport }[] = [
  {
    label: "the list read again after the balance has come",
    list: listReport({ reading: true, onScreen: true }),
  },
  {
    label: "the list's first page read after the balance has come",
    list: listReport({ reading: true }),
  },
];

test.each(listReads)(
  '"Obnovuji…" lasts while either read is under way: $label',
  ({ list }) => {
    expect(
      shown(facts({ session: LUCIE, balance: READ, reading: "no", list })),
    ).toMatchObject({
      screen: "account",
      header: { balance: READ, refreshing: true },
    });
  },
);

test("After the server woke, the waiting screen holds the list's place until the newest page has come, with no placeholders after it", () => {
  // The first answer took 20 s; the balance has come since, and the header shows it as it stands, never refreshing.
  const afterTheWake: Partial<Facts> = {
    session: LUCIE,
    balance: READ,
    reading: "no",
    wait: "long",
    wokeUp: true,
  };

  expect(
    shown(facts({ ...afterTheWake, list: listReport({ reading: true }) })),
    "the newest page is still read",
  ).toMatchObject({
    screen: "account",
    header: { balance: READ, refreshing: false },
    body: "waking",
  });
  expect(
    shown(facts({ ...afterTheWake, list: listReport({ onScreen: true }) })),
    "the newest page has come",
  ).toMatchObject({
    screen: "account",
    header: { balance: READ, refreshing: false },
    body: "list",
  });
});

// D8: once a list is on screen it stays, under the banner, through every reload; the offline note and the waking-up
// screen take the list's place only while none has come.
const listOnScreen: {
  label: string;
  changes: Partial<Facts>;
  shows: object;
}[] = [
  {
    label: "both reads fail at the bank, with no balance to show",
    changes: {
      session: LUCIE,
      problem: BANK_DOWN,
      list: listReport({ problem: BANK_DOWN, onScreen: true }),
    },
    shows: { header: null, body: "list" },
  },
  {
    label: "the server woke, and the balance is still read",
    changes: {
      session: LUCIE,
      balance: STORED,
      reading: "first",
      wait: "long",
      wokeUp: true,
      list: listReport({ onScreen: true }),
    },
    shows: { body: "list" },
  },
  {
    label: "the balance's read finds the phone offline",
    changes: {
      session: LUCIE,
      balance: READ,
      problem: OFFLINE,
      list: listReport({ onScreen: true }),
    },
    shows: { banner: OFFLINE, body: "list" },
  },
  {
    label: "the list's read finds the phone offline",
    changes: {
      session: LUCIE,
      balance: READ,
      list: listReport({ problem: LIST_OFFLINE, onScreen: true }),
    },
    shows: { banner: OFFLINE, body: "list" },
  },
];

test.each(listOnScreen)(
  "A list on screen stays through a reload that fails, wakes or finds the phone offline: $label",
  ({ changes, shows }) => {
    expect(shown(facts(changes))).toMatchObject({
      screen: "account",
      ...shows,
    });
  },
);

/** The account screen's banner; `undefined` for any other screen. */
function bannerOf(screen: Shown): Problem | null | undefined {
  return screen.screen === "account" ? screen.banner : undefined;
}
