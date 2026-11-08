import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import { nobodySignedIn, refused, signedIn } from "../test/server";

const SIGN_IN_BUTTON = "Přihlásit se účtem Microsoft";

scenario(
  "sign-in",
  "The sign-in screen shows when nobody is signed in",
  async () => {
    renderApp("iPhone Home Screen", { whoIsSignedIn: nobodySignedIn });

    expect(
      await screen.findByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();
    const name = screen.getByText("Tarjeta Papá");
    expect(name.closest("[lang]")).toHaveAttribute("lang", "es");
    expect(
      screen.getByText("Uvidíš tu zůstatek a pohyby na tátově eurovém účtu."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Použij účet Microsoft, který ti táta povolil."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  },
);

scenario(
  "sign-in",
  "Tapping the sign-in button starts the Microsoft sign-in",
  async () => {
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: nobodySignedIn,
    });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: SIGN_IN_BUTTON }),
    );

    await waitFor(() => expect(app.navigations()).toEqual(["/api/auth/login"]));
  },
);

scenario(
  "sign-in",
  "A refused account sees that it has no access",
  async () => {
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: refused("cizi.ucet@example.com"),
    });

    const error = await screen.findByRole("alert");
    expect(
      within(error).getByText("Tenhle účet nemá přístup"),
    ).toBeInTheDocument();
    expect(
      within(error).getByText(
        "Účet cizi.ucet@example.com tu není povolený. Přihlas se tím, který ti táta povolil.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zkusit jiný účet" }),
    ).toBeInTheDocument();
  },
);

scenario(
  "sign-in",
  "Trying another account signs out and starts a new sign-in",
  async () => {
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: refused("cizi.ucet@example.com"),
    });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Zkusit jiný účet" }),
    );

    await waitFor(() =>
      expect(app.navigations()).toEqual([
        "/api/auth/login?anotherAccount=true",
      ]),
    );
    const timeline = app.timeline();
    const signedOut = timeline.indexOf("answer POST /api/auth/logout");
    expect(signedOut, "the server answered the sign-out").not.toBe(-1);
    expect(
      timeline.indexOf("navigation /api/auth/login?anotherAccount=true"),
      "the new sign-in starts after the sign-out",
    ).toBeGreaterThan(signedOut);
  },
);

scenario(
  "sign-in",
  "Signing out from the account menu shows the signed-out screen",
  async () => {
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: signedIn("Lucie Nováková", "lucie@example.com"),
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Účet a odhlášení" }),
    );

    await user.click(
      await screen.findByRole("menuitem", { name: "Odhlásit se" }),
    );

    const note = await screen.findByRole("status");
    expect(
      app.timeline(),
      "the server answered the sign-out before the screen says so",
    ).toContain("answer POST /api/auth/logout");
    expect(note).toHaveTextContent(
      "Odhlášení proběhlo. Pro návrat se znovu přihlas.",
    );
    expect(
      screen.getByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();
  },
);
