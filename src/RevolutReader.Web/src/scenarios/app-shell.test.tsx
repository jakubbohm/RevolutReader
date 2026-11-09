import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  goOffline,
  goOnline,
  kept,
  leaveApp,
  noAnswerYet,
  phoneKeeps,
  serverError,
  signedIn,
} from "../test/server";

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const WAKING_UP = "Server se probouzí";
const WAKING_UP_SENTENCE =
  "Když ho chvíli nikdo nepoužívá, usne. První načtení trvá asi 20 sekund.";
const SLOW_WAKE =
  "Trvá to déle než obvykle. Zkontroluj připojení, nebo to zkus znovu.";
const OFFLINE_NOTHING_STORED =
  "Zůstatek a pohyby se načtou, jakmile budeš online.";
const HEALTH_CHECK = "GET /health";

scenario("app-shell", "The top bar shows the app name", async () => {
  renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });

  const name = within(await screen.findByRole("banner")).getByText(
    "Tarjeta Papá",
  );
  expect(name).toBeInTheDocument();
  expect(name.closest("[lang]")).toHaveAttribute("lang", "es");
});

scenario("app-shell", "The account menu shows who is signed in", async () => {
  renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", {
    name: "Účet a odhlášení",
  });
  expect(screen.getByRole("banner")).toContainElement(trigger);

  await user.click(trigger);

  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText("Přihlášený účet")).toBeInTheDocument();
  expect(within(menu).getByText("Lucie Nováková")).toBeInTheDocument();
  expect(within(menu).getByText("lucie@example.com")).toBeInTheDocument();
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
  expect(
    within(menu).getByRole("menuitem", { name: "Odhlásit se" }),
  ).toBeInTheDocument();
});

scenario(
  "app-shell",
  "A sleeping server shows the waking-up screen after 1.5 seconds",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: after(20 * SECOND, LUCIE),
      balance: balance(286.4),
    });

    await timePasses(0);
    expect(screen.queryByText(WAKING_UP)).not.toBeInTheDocument();
    await timePasses(1.5 * SECOND);
    expect(screen.getByText(WAKING_UP)).toBeInTheDocument();
    expect(screen.getByText(WAKING_UP_SENTENCE)).toBeInTheDocument();

    await timePasses(20 * SECOND - 1.5 * SECOND);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText(WAKING_UP)).not.toBeInTheDocument();
  },
);

scenario(
  "app-shell",
  "A slow wake offers to try again after 30 seconds",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: noAnswerYet,
    });
    const user = userOnTheTestClock();

    await timePasses(29 * SECOND);
    expect(screen.queryByText(SLOW_WAKE)).not.toBeInTheDocument();
    await timePasses(SECOND);

    expect(screen.getByText(WAKING_UP)).toBeInTheDocument();
    expect(screen.getByText(SLOW_WAKE)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Zkusit znovu" });
    expect(app.timesSent("GET /api/me")).toBe(1);
    await user.click(retry);
    await timePasses(0);
    expect(app.timesSent("GET /api/me")).toBe(2);
  },
);

scenario(
  "app-shell",
  "A stored balance shows at once while the server wakes",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: after(20 * SECOND, LUCIE),
      balance: balance(286.4),
    });

    // At once: no time passes, the app only reads what the phone keeps.
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.getByText("Aktualizováno před 2 h")).toBeInTheDocument();
    expect(screen.queryByText(WAKING_UP)).not.toBeInTheDocument();

    await timePasses(1.5 * SECOND);
    const stored = screen.getByText("286,40 €");
    const wakingUp = screen.getByText(WAKING_UP);
    expect(
      stored.compareDocumentPosition(wakingUp) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "the waking-up screen stands below the balance",
    ).toBeTruthy();
  },
);

scenario(
  "app-shell",
  "Offline with a stored balance shows it with the offline banner",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    goOffline();

    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.getByText("Aktualizováno před 2 h")).toBeInTheDocument();
    const warning = warningBanner("Jsi offline");
    expect(
      within(warning).getByRole("button", { name: "Zkusit znovu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pohyby se načtou, jakmile budeš online."),
    ).toBeInTheDocument();
  },
);

scenario(
  "app-shell",
  "Offline with nothing stored says the balance loads once online",
  async () => {
    startTestClock();
    goOffline();

    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });
    await timePasses(0);

    expect(screen.getByText("Jsi offline")).toBeInTheDocument();
    expect(screen.getByText(OFFLINE_NOTHING_STORED)).toBeInTheDocument();
    // Only these two under the top bar: nothing else to read there.
    expect(textOf(screen.getByRole("main"))).toBe(
      textOf("Jsi offline", OFFLINE_NOTHING_STORED),
    );
    expect(app.requests()).toEqual([]);
  },
);

scenario("app-shell", "Coming back online loads what was waiting", async () => {
  startTestClock();
  goOffline();
  renderApp("iPhone Home Screen", {
    whoIsSignedIn: LUCIE,
    balance: balance(286.4),
  });
  await timePasses(0);
  expect(screen.getByText("Jsi offline")).toBeInTheDocument();

  goOnline();
  await timePasses(0);

  expect(screen.getByText("286,40 €")).toBeInTheDocument();
});

scenario(
  "app-shell",
  "A refresh with no answer for 60 seconds counts as offline",
  async () => {
    startTestClock();
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: [balance(286.4), noAnswerYet],
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Obnovit" }));
    await timePasses(59 * SECOND);
    expect(screen.queryByText("Jsi offline")).not.toBeInTheDocument();
    await timePasses(SECOND);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(warningBanner("Jsi offline")).toBeInTheDocument();
  },
);

scenario(
  "app-shell",
  "An unexpected answer to who is signed in shows a banner with a retry",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: serverError,
    });
    const user = userOnTheTestClock();

    await timePasses(0);

    const error = errorBanner("Zůstatek se nepodařilo načíst");
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    const retry = within(error).getByRole("button", { name: "Zkusit znovu" });
    expect(app.timesSent("GET /api/me")).toBe(1);
    await user.click(retry);
    await timePasses(0);
    expect(app.timesSent("GET /api/me")).toBe(2);
  },
);

scenario(
  "app-shell",
  "The app keeps the server awake while it is on the screen",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });

    await timePasses(0);
    expect(app.timesSent(HEALTH_CHECK), "when it opened").toBe(1);
    await timePasses(4 * MINUTE - SECOND);
    expect(app.timesSent(HEALTH_CHECK), "before 4 minutes").toBe(1);
    await timePasses(SECOND);
    expect(app.timesSent(HEALTH_CHECK), "after 4 minutes").toBe(2);
    await timePasses(4 * MINUTE - SECOND);
    expect(app.timesSent(HEALTH_CHECK), "before 8 minutes").toBe(2);
    await timePasses(SECOND);
    expect(app.timesSent(HEALTH_CHECK), "after 8 minutes").toBe(3);

    leaveApp();
    await timePasses(8 * MINUTE);
    expect(app.timesSent(HEALTH_CHECK), "in the background").toBe(3);
  },
);

scenario(
  "app-shell",
  "The app lets the server sleep after 30 minutes without use",
  async () => {
    startTestClock();
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
    });
    const user = userOnTheTestClock();

    await timePasses(28 * MINUTE - SECOND);
    expect(app.timesSent(HEALTH_CHECK), "up to 24 minutes, every 4").toBe(7);
    await timePasses(SECOND);
    expect(app.timesSent(HEALTH_CHECK), "the one at 28 minutes").toBe(8);
    await timePasses(40 * MINUTE - 28 * MINUTE);
    expect(app.timesSent(HEALTH_CHECK), "none after 28 minutes").toBe(8);

    await user.click(screen.getByRole("main"));
    await timePasses(0);
    expect(app.timesSent(HEALTH_CHECK), "as soon as someone taps").toBe(9);
  },
);

/** Text as one reads it, with no regard to how it is spaced or split into elements. */
function textOf(...parts: (HTMLElement | string)[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : (part.textContent ?? "")))
    .join("")
    .replace(/\s+/g, "");
}
