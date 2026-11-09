import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
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
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankUnavailable,
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
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), bankRateLimited],
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
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: bankAccessExpired,
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

/** An element's text as one reads it, with no regard to how it is spaced or split into elements. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, "");
}
