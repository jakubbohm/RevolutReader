import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import { signedIn } from "../test/server";

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");

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
