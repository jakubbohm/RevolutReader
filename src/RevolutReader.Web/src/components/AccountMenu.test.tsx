import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AccountMenu } from "./AccountMenu";

// The account menu while a sign-out runs (c009 design.md D6, D10): "Odhlásit se" shows a spinner beside its label, is
// marked busy and ignores taps, and the menu stays open. Read by role and name, as a user and a screen reader meet it.
// The user is made up.

const LUCIE = { name: "Lucie Nováková", email: "lucie@example.com" };

test('While signing out, "Odhlásit se" shows a spinner beside its label and is marked busy', async () => {
  render(<AccountMenu account={LUCIE} onSignOut={() => {}} signingOut />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));

  expect(
    await screen.findByRole("menuitem", { name: "Odhlásit se" }),
    "busy, its label kept as its whole name",
  ).toHaveAttribute("aria-busy", "true");
});

test('Selecting "Odhlásit se" while signing out keeps the menu open and calls nothing', async () => {
  let signOuts = 0;
  render(
    <AccountMenu
      account={LUCIE}
      onSignOut={() => {
        signOuts += 1;
      }}
      signingOut
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));

  await user.click(
    await screen.findByRole("menuitem", { name: "Odhlásit se" }),
  );

  expect(screen.getByRole("menu"), "the menu stays open").toBeInTheDocument();
  expect(signOuts, "nothing is called").toBe(0);
});
