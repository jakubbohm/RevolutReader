import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { errorBanner, warningBanner } from "../test/banners";
import {
  ago,
  HOUR,
  SECOND,
  startTestClock,
  timePasses,
  userOnTheTestClock,
} from "../test/clock";
import { scrollToEnd } from "../test/intersection";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  balance,
  bankAccessExpired,
  bankRateLimited,
  bankUnavailable,
  goOffline,
  goOnline,
  kept,
  noAnswerYet,
  phoneKeeps,
  serverError,
  signedIn,
  transaction,
  transactionsPage,
} from "../test/server";

// Amounts are written as the spec writes them: U+2212 for a minus sign. Spaces are matched as any whitespace, the
// no-break spaces the app writes inside amounts and dates among them, as Testing Library's text matching does.
//
// The list sits in C7a's account screen, which reads the balance with the transactions: every scenario's server answers
// the balance too, and the phone keeps one where the scenario says so (c010 design.md D8).

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");

/** The scenarios' today, 2026-11-20, at 10:00 on the phone's clock in whatever time zone the tests run. */
const TODAY = new Date(2026, 10, 20, 10, 0);

/** A settled card payment of -12.30 EUR to "Pekárna U Lípy" on 2026-11-18, with the detail "Praha 2". */
const BAKERY_IN_PRAGUE_2 = transaction("card", -12.3, "2026-11-18", {
  counterparty: "Pekárna U Lípy",
  details: ["Praha 2"],
});

/** The payment the next older page holds: -7.50 EUR to "Knihkupectví Luxor" on 2026-10-15. */
const BOOKSHOP = transaction("card", -7.5, "2026-10-15", {
  counterparty: "Knihkupectví Luxor",
});

/** A payment of -3.80 EUR to "Trafika Můstek", settled today. */
const NEWSAGENT_TODAY = transaction("card", -3.8, "2026-11-20", {
  counterparty: "Trafika Můstek",
});

/** C7a's waiting screen while the server wakes. */
const WAKING_UP = "Server se probouzí";

scenario(
  "account-transactions",
  "The list shows placeholders while the transactions load",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: noAnswerYet,
    });

    await timePasses(0);

    expect(
      screen.getByRole("status", { name: "Načítám pohyby" }),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "The account screen lists the transactions by day, newest first",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("card", -3.8, "2026-11-20", {
          counterparty: "Trafika Můstek",
        }),
        transaction("topup", 50, "2026-11-19"),
        transaction("card", -12.3, "2026-11-18", {
          counterparty: "Pekárna U Lípy",
        }),
      ]),
    });

    await timePasses(0);

    expect(dayHeadings()).toEqual(["Dnes", "Včera", "středa 18. listopadu"]);
    expect(within(day("Dnes")).getByText("Trafika Můstek")).toBeInTheDocument();
    expect(within(day("Včera")).getByText("Dobití účtu")).toBeInTheDocument();
    expect(
      within(day("středa 18. listopadu")).getByText("Pekárna U Lípy"),
    ).toBeInTheDocument();
    // The day's money received, as its header says it to a screen reader (design system DayHeader).
    expect(day("Včera")).toHaveTextContent("Příchozí 50,00 €");
  },
);

scenario(
  "account-transactions",
  "A row shows the counterparty, the bank's text and the amount with its koruna value",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2]),
    });

    await timePasses(0);

    const shown = row("Pekárna U Lípy");
    expect(within(shown).getByText("Praha 2")).toBeInTheDocument();
    expect(within(shown).getByText("−12,30 €")).toBeInTheDocument();
    expect(within(shown).getByText("≈ 299 Kč")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "A row without the bank's own text names the kind of payment",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("card", -12.3, "2026-11-18", {
          counterparty: "Pekárna U Lípy",
        }),
      ]),
    });

    await timePasses(0);

    const shown = row("Pekárna U Lípy");
    expectInOrder(
      within(shown).getByText("Pekárna U Lípy"),
      within(shown).getByText("Platba kartou"),
    );
  },
);

scenario(
  "account-transactions",
  "A row without a counterparty names the kind of transaction",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("atm", -40, "2026-11-18", {
          details: ["Bankomat Můstek"],
        }),
      ]),
    });

    await timePasses(0);

    const shown = row("Výběr z bankomatu");
    expectInOrder(
      within(shown).getByText("Výběr z bankomatu"),
      within(shown).getByText("Bankomat Můstek"),
    );
  },
);

scenario(
  "account-transactions",
  "A row without a counterparty or text names an unknown kind by its direction",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([transaction("other", 20, "2026-11-18")]),
    });

    await timePasses(0);

    const shown = row("Příchozí platba");
    expect(within(shown).getByText("+20,00 €")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "Tapping a transaction opens its details",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2]),
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    await user.click(row("Pekárna U Lípy"));
    await timePasses(0);

    const details = screen.getByRole("dialog", { name: "Pekárna U Lípy" });
    for (const shown of [
      "Platba kartou",
      "−12,30 €",
      "≈ 299 Kč",
      "Zaúčtováno",
      "18. 11. 2026",
      "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026",
    ])
      expect(within(details).getByText(shown)).toBeInTheDocument();
    expectInOrder(
      within(details).getByText("Popis"),
      within(details).getByText("Praha 2"),
    );
  },
);

scenario(
  "account-transactions",
  "The details leave out the description when the bank gave no text of its own",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("card", -12.3, "2026-11-18", {
          counterparty: "Pekárna U Lípy",
        }),
      ]),
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    await user.click(row("Pekárna U Lípy"));
    await timePasses(0);

    const details = screen.getByRole("dialog", { name: "Pekárna U Lípy" });
    expect(within(details).queryByText("Popis")).not.toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "A pending transaction is marked as waiting",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("card", -8.9, "2026-11-19", {
          counterparty: "Kavárna Na Rohu",
          pending: true,
        }),
      ]),
    });

    await timePasses(0);

    const shown = row("Kavárna Na Rohu");
    expectInOrder(
      within(shown).getByText("Kavárna Na Rohu"),
      within(shown).getByText("Čeká na zpracování"),
    );
    expect(within(shown).getByText("−8,90 €")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "A refund is marked as one in the list and in its details",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([
        transaction("refund", 5.95, "2026-11-18", {
          counterparty: "Lékárna Benu",
          details: ["Reklamace"],
        }),
      ]),
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    const shown = row("Lékárna Benu");
    expectInOrder(
      within(shown).getByText("Vrácení"),
      within(shown).getByText("Reklamace"),
    );
    expect(within(shown).getByText("+5,95 €")).toBeInTheDocument();
    await user.click(shown);
    await timePasses(0);

    const details = screen.getByRole("dialog", { name: "Lékárna Benu" });
    expect(within(details).getByText("Vrácení peněz")).toBeInTheDocument();
    expect(within(details).getByText("Vráceno na účet")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "An account with no transactions says so",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([], { olderBefore: null }),
    });

    await timePasses(0);

    expect(screen.getByText("Zatím žádné pohyby")).toBeInTheDocument();
    expect(
      screen.getByText("Jakmile proběhne první platba, uvidíš ji tady."),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "Expired bank access asks to let Dad know about the transactions",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: bankAccessExpired,
    });

    await timePasses(0);

    const error = errorBanner("Propojení s bankou vypršelo");
    expect(
      within(error).getByText(
        "Obnovit propojení musí táta, dej mu prosím vědět.",
      ),
    ).toBeInTheDocument();
    expect(within(error).queryByRole("button")).not.toBeInTheDocument();
    expectNoTransactions();
  },
);

scenario(
  "account-transactions",
  "Too many refreshes shows a warning instead of the transactions",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: bankRateLimited,
    });

    await timePasses(0);

    const warning = warningBanner("Příliš mnoho obnovení");
    expect(
      within(warning).getByText(
        "Banka teď další dotazy nepřijímá. Zkus to znovu později.",
      ),
    ).toBeInTheDocument();
    expect(within(warning).queryByRole("button")).not.toBeInTheDocument();
    expectNoTransactions();
  },
);

scenario(
  "account-transactions",
  "A bank that does not answer the transactions shows a retry",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: [bankUnavailable, transactionsPage([BAKERY_IN_PRAGUE_2])],
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    const error = errorBanner("Pohyby se nepodařilo načíst");
    expect(
      within(error).getByText(
        "Banka teď neodpovídá. Zkus to prosím za chvíli.",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(error).getByRole("button", { name: "Zkusit znovu" }),
    );
    await timePasses(0);

    expect(row("Pekárna U Lípy")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "An unexpected answer to the transactions read shows a retry",
  async () => {
    startTestClock(TODAY);
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: [serverError, transactionsPage([BAKERY_IN_PRAGUE_2])],
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    const error = errorBanner("Pohyby se nepodařilo načíst");
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    await user.click(
      within(error).getByRole("button", { name: "Zkusit znovu" }),
    );
    await timePasses(0);

    expect(
      app.requests().filter((sent) => sent === "GET /api/transactions"),
    ).toHaveLength(2);
  },
);

scenario(
  "account-transactions",
  "Offline, the transactions load once the phone is back online",
  async () => {
    startTestClock(TODAY);
    // The phone keeps a balance (the GIVEN; c010 design.md D8: C7a's server setup, so the scenario holds unchanged).
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    goOffline();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2]),
    });

    await timePasses(0);

    expect(
      screen.getByText("Pohyby se načtou, jakmile budeš online."),
    ).toBeInTheDocument();
    goOnline();
    await timePasses(0);
    expect(row("Pekárna U Lípy")).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "Older transactions load when the list reaches its end",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2], {
        olderBefore: "2026-10-20",
      }),
      olderTransactions: { "2026-10-20": transactionsPage([BOOKSHOP]) },
    });
    await timePasses(0);

    scrollToEnd();
    await timePasses(0);

    expect(dayHeadings()).toEqual([
      "středa 18. listopadu",
      "čtvrtek 15. října",
    ]);
    expect(
      within(day("čtvrtek 15. října")).getByText("Knihkupectví Luxor"),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "Older transactions that failed to load can be tried again",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2], {
        olderBefore: "2026-10-20",
      }),
      olderTransactions: {
        "2026-10-20": [serverError, transactionsPage([BOOKSHOP])],
      },
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    scrollToEnd();
    await timePasses(0);

    const failed = screen.getByText("Starší pohyby se nepodařilo načíst");
    const retry = screen.getByRole("button", { name: "Zkusit znovu" });
    expectInOrder(day("středa 18. listopadu"), failed, retry);
    await user.click(retry);
    await timePasses(0);
    expect(
      within(day("čtvrtek 15. října")).getByText("Knihkupectví Luxor"),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "The list ends where the history ends",
  async () => {
    startTestClock(TODAY);
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: transactionsPage([BAKERY_IN_PRAGUE_2], {
        olderBefore: null,
      }),
    });
    await timePasses(0);

    scrollToEnd();
    await timePasses(0);

    expectInOrder(
      day("středa 18. listopadu"),
      screen.getByText("Žádné starší pohyby"),
    );
    expect(
      app
        .requests()
        .filter((sent) => sent.startsWith("GET /api/transactions/older")),
    ).toEqual([]);
  },
);

scenario(
  "account-transactions",
  "Refreshing replaces the newest transactions and keeps the older ones",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: [
        transactionsPage([BAKERY_IN_PRAGUE_2], { olderBefore: "2026-10-20" }),
        transactionsPage([NEWSAGENT_TODAY, BAKERY_IN_PRAGUE_2], {
          olderBefore: "2026-10-20",
        }),
      ],
      olderTransactions: { "2026-10-20": transactionsPage([BOOKSHOP]) },
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    scrollToEnd();
    await timePasses(0);
    expect(
      within(day("čtvrtek 15. října")).getByText("Knihkupectví Luxor"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(dayHeadings()).toEqual([
      "Dnes",
      "středa 18. listopadu",
      "čtvrtek 15. října",
    ]);
    expect(within(day("Dnes")).getByText("Trafika Můstek")).toBeInTheDocument();
    expect(
      within(day("čtvrtek 15. října")).getByText("Knihkupectví Luxor"),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  '"Obnovuji…" lasts until the transactions have come too',
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), balance(301.9)],
      transactions: [
        transactionsPage([BAKERY_IN_PRAGUE_2]),
        after(
          3 * SECOND,
          transactionsPage([NEWSAGENT_TODAY, BAKERY_IN_PRAGUE_2]),
        ),
      ],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(row("Pekárna U Lípy")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(screen.getByText("Obnovuji…")).toBeInTheDocument();
    await timePasses(2 * SECOND);
    expect(screen.getByText("Obnovuji…")).toBeInTheDocument();
    await timePasses(SECOND);
    expect(screen.queryByText("Obnovuji…")).not.toBeInTheDocument();
  },
);

scenario(
  "account-transactions",
  "A bank that answers neither read shows one banner",
  async () => {
    startTestClock(TODAY);
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankUnavailable,
      transactions: bankUnavailable,
    });
    const user = userOnTheTestClock();
    await timePasses(0);

    const error = errorBanner("Banka teď neodpovídá");
    expect(screen.getAllByRole("alert"), "the errors shown").toHaveLength(1);
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    const retry = within(error).getByRole("button", { name: "Zkusit znovu" });
    expect(app.timesSent("GET /api/balance")).toBe(1);
    expect(app.timesSent("GET /api/transactions")).toBe(1);
    await user.click(retry);
    await timePasses(0);
    expect(app.timesSent("GET /api/balance")).toBe(2);
    expect(app.timesSent("GET /api/transactions")).toBe(2);
  },
);

scenario(
  "account-transactions",
  "After the server wakes, the transactions replace the waiting screen directly",
  async () => {
    startTestClock(TODAY);
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: after(20 * SECOND, LUCIE),
      balance: balance(286.4),
      // The transactions come a second after the balance, so the screen between the two answers can be seen.
      transactions: after(SECOND, transactionsPage([BAKERY_IN_PRAGUE_2])),
    });

    await timePasses(1.5 * SECOND);
    expectInOrder(screen.getByText("286,40 €"), screen.getByText(WAKING_UP));
    // The server is awake and the balance has come; the transactions have not.
    await timePasses(20 * SECOND - 1.5 * SECOND);
    expectInOrder(screen.getByText("286,40 €"), screen.getByText(WAKING_UP));
    expectNoPlaceholders();

    await timePasses(SECOND);

    expect(row("Pekárna U Lípy")).toBeInTheDocument();
    expect(screen.queryByText(WAKING_UP)).not.toBeInTheDocument();
    expectNoPlaceholders();
  },
);

scenario(
  "account-transactions",
  "The transactions stay on screen through a failed refresh",
  async () => {
    startTestClock(TODAY);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      transactions: [transactionsPage([BAKERY_IN_PRAGUE_2]), bankUnavailable],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(row("Pekárna U Lípy")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expectInOrder(
      errorBanner("Pohyby se nepodařilo načíst"),
      row("Pekárna U Lípy"),
    );
  },
);

/** Text as Testing Library compares it: every run of whitespace, a no-break space among them, as one space; trimmed. */
function spaced(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The list's day headings (design system DayHeader: one `h2` per day), top to bottom. */
function dayHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => spaced(heading.textContent));
}

/** The day group headed `label` (design system DayGroup: a region named by its heading). */
function day(label: string): HTMLElement {
  return screen.getByRole("region", {
    name: (name) => spaced(name) === label,
  });
}

/** The one transaction row that shows `text`: a button, as the row is tapped to open its details. */
function row(text: string): HTMLElement {
  const rows = screen
    .queryAllByRole("button")
    .filter((button) => within(button).queryByText(text) !== null);
  if (rows.length !== 1)
    throw new Error(
      `Expected one transaction row (a button) showing "${text}", found ${rows.length}.`,
    );
  return rows[0]!;
}

/** Each element comes after the one before it on the page: below it, or later in the same line. */
function expectInOrder(...elements: HTMLElement[]): void {
  for (let index = 1; index < elements.length; index += 1)
    expect(
      elements[index - 1]!.compareDocumentPosition(elements[index]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      `"${spaced(elements[index]!.textContent)}" comes after "${spaced(elements[index - 1]!.textContent)}"`,
    ).toBeTruthy();
}

/** The list shows no placeholders (design system Skeleton: a status named "Načítám pohyby"). */
function expectNoPlaceholders(): void {
  expect(
    screen.queryByRole("status", { name: "Načítám pohyby" }),
    "the list's placeholders",
  ).not.toBeInTheDocument();
}

/** No transaction shows: no day of the list, no placeholders, and no "no transactions yet" either. */
function expectNoTransactions(): void {
  expect(
    screen.queryAllByRole("heading", { level: 2 }),
    "the list's days",
  ).toEqual([]);
  expect(
    screen.queryByRole("status", { name: "Načítám pohyby" }),
    "the list's placeholders",
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Zatím žádné pohyby"),
    "the empty list",
  ).not.toBeInTheDocument();
}
