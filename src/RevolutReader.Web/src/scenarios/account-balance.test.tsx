import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { balanceLook } from "../test/balanceLook";
import { errorBanner, warningBanner } from "../test/banners";
import {
  ago,
  HOUR,
  MINUTE,
  SECOND,
  startTestClock,
  timePasses,
  userOnTheTestClock,
} from "../test/clock";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  balance,
  bankAccessExpired,
  bankRateLimited,
  bankUnavailable,
  DEFAULT_TRANSACTIONS,
  goOffline,
  kept,
  leaveApp,
  nobodySignedIn,
  phoneKeeps,
  returnToApp,
  serverError,
  signedIn,
} from "../test/server";

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const SIGN_IN_BUTTON = "Přihlásit se účtem Microsoft";
const WAKING_UP = "Server se probouzí";

scenario(
  "account-balance",
  "The account screen shows the balance, its koruna value and when it was read",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4, { readAt: ago(2 * MINUTE), czkPerEur: 24.3 }),
    });

    await timePasses(0);

    expect(screen.getByText("Na účtu máš")).toBeInTheDocument();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.getByText("≈ 6 960 Kč")).toBeInTheDocument();
    expect(screen.getByText("Aktualizováno před 2 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Obnovit" })).toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  'Tapping "Obnovit" reads the balance again',
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), after(2 * SECOND, balance(301.9))],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(screen.getByText("Obnovuji…")).toBeInTheDocument();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    await timePasses(2 * SECOND);
    expect(screen.getByText("301,90 €")).toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "Coming back to the app reads the balance again",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), balance(301.9)],
    });
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    leaveApp();
    await timePasses(MINUTE);
    returnToApp();
    await timePasses(0);

    expect(screen.getByText("301,90 €")).toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "A balance read replaces the one the phone keeps",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    goOffline();
    app.reopen();
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "A bank that does not answer shows a banner with a retry",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    // The bank answers no read, the transactions' neither (c010 design.md D8).
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankUnavailable,
      transactions: bankUnavailable,
    });

    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.getByText("Aktualizováno před 2 h")).toBeInTheDocument();
    const error = errorBanner("Banka teď neodpovídá");
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    expect(
      within(error).getByRole("button", { name: "Zkusit znovu" }),
    ).toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "Too many refreshes shows a warning with no action",
  async () => {
    startTestClock();
    // The bank's limit holds for every read, so the transactions read with the refresh meets it too (c010 design.md D8).
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), bankRateLimited],
      transactions: [DEFAULT_TRANSACTIONS, bankRateLimited],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    const warning = warningBanner("Příliš mnoho obnovení");
    expect(
      within(warning).getByText(
        "Banka teď další dotazy nepřijímá. Zkus to znovu později.",
      ),
    ).toBeInTheDocument();
    expect(within(warning).queryByRole("button")).not.toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "Expired bank access asks to let Dad know",
  async () => {
    startTestClock();
    // The access to the account has expired for every read of it, the transactions too (c010 design.md D8).
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankAccessExpired,
      transactions: bankAccessExpired,
    });

    await timePasses(0);

    const error = errorBanner("Propojení s bankou vypršelo");
    expect(
      within(error).getByText(
        "Obnovit propojení musí táta, dej mu prosím vědět.",
      ),
    ).toBeInTheDocument();
    // Only the banner under the top bar: nothing else to read there, no placeholder, and no button.
    const content = screen.getByRole("main");
    expect(textOf(content)).toBe(textOf(error));
    expect(within(content).queryByRole("status")).not.toBeInTheDocument();
    expect(within(content).queryByRole("button")).not.toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "An unexpected answer to the balance read shows a banner with a retry",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: serverError,
    });
    const user = userOnTheTestClock();

    await timePasses(0);

    const error = errorBanner("Zůstatek se nepodařilo načíst");
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    const retry = within(error).getByRole("button", { name: "Zkusit znovu" });
    expect(app.timesSent("GET /api/balance")).toBe(1);
    await user.click(retry);
    await timePasses(0);
    expect(app.timesSent("GET /api/balance")).toBe(2);
  },
);

scenario(
  "account-balance",
  "Signing out forgets the balance on the phone",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));
    await user.click(screen.getByRole("menuitem", { name: "Odhlásit se" }));
    await timePasses(0);
    expect(
      screen.getByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();

    goOffline();
    app.reopen();
    await timePasses(0);
    expect(screen.getByText("Jsi offline")).toBeInTheDocument();
    expect(
      screen.getByText("Zůstatek a pohyby se načtou, jakmile budeš online."),
    ).toBeInTheDocument();
    expect(screen.queryByText("286,40 €")).not.toBeInTheDocument();
  },
);

scenario(
  "account-balance",
  "A login that has ended forgets the balance on the phone",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: nobodySignedIn,
    });

    await timePasses(0);

    expect(
      screen.getByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();
    goOffline();
    app.reopen();
    await timePasses(0);
    expect(screen.getByText("Jsi offline")).toBeInTheDocument();
    expect(
      screen.getByText("Zůstatek a pohyby se načtou, jakmile budeš online."),
    ).toBeInTheDocument();
    expect(screen.queryByText("286,40 €")).not.toBeInTheDocument();
  },
);

// ---- c019: whether the balance is live (design.md D8) ----
// The look is read with `balanceLook` (../test/balanceLook.ts): "ink", "grey, moving" or "grey, still". A balance the
// server answers differs from the kept one unless the scenario says otherwise, so the look read is the kept balance's.

scenario(
  "account-balance",
  "The balance turns ink when the server's balance arrives",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });

    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
    expect(balanceLook("286,40 €")).toBe("ink");
  },
);

scenario(
  "account-balance",
  "A refresh keeps a confirmed balance in ink",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), after(2 * SECOND, balance(301.9))],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(balanceLook("286,40 €"), "she sees it in ink").toBe("ink");

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(screen.getByText("Obnovuji…")).toBeInTheDocument();
    expect(balanceLook("286,40 €")).toBe("ink");
  },
);

scenario(
  "account-balance",
  "A failed refresh turns the balance grey",
  async () => {
    startTestClock();
    // The bank answers the first read, then no more: the transactions read with the refresh meets it too (c010 D8).
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), bankUnavailable],
      transactions: [DEFAULT_TRANSACTIONS, bankUnavailable],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(balanceLook("286,40 €"), "she sees it in ink").toBe("ink");

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(0);

    expect(errorBanner("Banka teď neodpovídá")).toBeInTheDocument();
    expect(balanceLook("286,40 €")).toMatch(/^grey, /);
  },
);

scenario(
  "account-balance",
  "Coming back to the app turns the balance grey until the answer",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), after(SECOND, balance(301.9))],
    });
    await timePasses(0);
    expect(balanceLook("286,40 €"), "she sees it in ink").toBe("ink");

    leaveApp();
    await timePasses(MINUTE);
    returnToApp();
    await timePasses(0);

    expect(balanceLook("286,40 €"), "until the answer").toMatch(/^grey, /);
    await timePasses(SECOND);
    expect(screen.queryByText("286,40 €")).not.toBeInTheDocument();
    expect(balanceLook("301,90 €"), "once it arrives").toBe("ink");
  },
);

scenario(
  "account-balance",
  "A stored balance is grey and moving while the server wakes",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: after(20 * SECOND, LUCIE),
      balance: balance(301.9),
    });

    await timePasses(0);
    expect(balanceLook("286,40 €"), "at once").toBe("grey, moving");
    expect(screen.queryByText(WAKING_UP)).not.toBeInTheDocument();

    await timePasses(1.5 * SECOND);
    const wakingUp = screen.getByText(WAKING_UP);
    expect(
      screen.getByText("286,40 €").compareDocumentPosition(wakingUp) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "the waking-up screen stands below the balance",
    ).toBeTruthy();
    expect(balanceLook("286,40 €"), "after 1.5 seconds").toBe("grey, moving");
  },
);

scenario(
  "account-balance",
  "A stored balance is grey and moving while an awake server answers",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: after(SECOND, balance(301.9)),
    });

    await timePasses(0);

    expect(screen.getByText("Obnovuji…")).toBeInTheDocument();
    expect(balanceLook("286,40 €")).toBe("grey, moving");
  },
);

scenario(
  "account-balance",
  "Offline, the stored balance is grey and still",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    goOffline();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(301.9),
    });

    await timePasses(0);

    expect(warningBanner("Jsi offline")).toBeInTheDocument();
    expect(balanceLook("286,40 €")).toBe("grey, still");
  },
);

scenario(
  "account-balance",
  "After a failed read, the stored balance is grey and still",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    // The bank answers no read, the transactions' neither (c010 design.md D8).
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankUnavailable,
      transactions: bankUnavailable,
    });

    await timePasses(0);

    expect(errorBanner("Banka teď neodpovídá")).toBeInTheDocument();
    expect(balanceLook("286,40 €")).toBe("grey, still");
  },
);

scenario(
  "account-balance",
  "A grey balance is spoken as a balance in ink",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR), 24.3));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: after(SECOND, balance(286.4, { czkPerEur: 24.3 })),
    });

    await timePasses(0);
    expect(balanceLook("286,40 €"), "while it is read").toMatch(/^grey, /);
    const whileGrey = spokenAmount();
    await timePasses(SECOND);
    expect(balanceLook("286,40 €"), "once it arrives").toBe("ink");
    const inInk = spokenAmount();

    expect(whileGrey.said).toEqual([
      "Na účtu máš",
      "286,40 €",
      "přibližně 6 960 Kč",
    ]);
    expect(inInk).toEqual(whileGrey);
  },
);

/** The ARIA a screen reader takes from an element besides its text: whether it is busy, what describes it, its name. */
const SPOKEN_ARIA = [
  "aria-busy",
  "aria-describedby",
  "aria-description",
  "aria-label",
] as const;

/**
 * What a screen reader takes from the header's region ("Na účtu máš") from its start up to the koruna value, in order
 * (nothing hidden from it, `aria-hidden`): `said`, every text and every image's name it reads, the heading, the amount
 * and the koruna value; `aria`, each of `SPOKEN_ARIA` that an element there carries, the region's own included, as
 * `<element> <attribute>="<value>"`. The freshness line and the button after the koruna value are left out, as they say
 * their own things (the button is busy while a read is under way).
 */
function spokenAmount(): { said: string[]; aria: string[] } {
  const header = screen.getByRole("region", { name: "Na účtu máš" });
  const said: string[] = [];
  const aria: string[] = [];
  let korunaRead = false;
  const read = (node: Node): void => {
    if (korunaRead) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text !== "") said.push(text);
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    for (const attribute of SPOKEN_ARIA) {
      const value = node.getAttribute(attribute);
      if (value !== null)
        aria.push(`${node.tagName.toLowerCase()} ${attribute}="${value}"`);
    }
    if (node.getAttribute("role") === "img") {
      const name = (node.getAttribute("aria-label") ?? "")
        .replace(/\s+/g, " ")
        .trim();
      said.push(name);
      korunaRead = name.endsWith("Kč");
      return;
    }
    for (const child of node.childNodes) read(child);
  };
  read(header);
  return { said, aria };
}

/** An element's text as one reads it, with no regard to how it is spaced or split into elements. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, "");
}
