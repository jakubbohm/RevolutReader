import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell, LogOut } from "lucide-react";
import { expect, test } from "vitest";
import { installPushStandIns } from "../test/push";
import { watchPermissionQuestions } from "../test/taps";
import { AccountMenu } from "./AccountMenu";

// The account menu while a sign-out runs (c009 design.md D6, D10): "Odhlásit se" shows a spinner beside its label, is
// marked busy and ignores taps, and the menu stays open. Its "Zapnout upozornění" (c012 design.md D1, D7): shown above
// "Odhlásit se" only while a handler for it is passed. Read by role and name, as a user and a screen reader meet it; a
// decorative icon has no role or name, so it is compared with Lucide's own icon by its drawing. The user is made up.

const LUCIE = { name: "Lucie Nováková", email: "lucie@example.com" };

/** The drawing of a Lucide icon on its own, to compare with the icon a menu item shows. */
function drawingOf(Icon: typeof Bell): string {
  const { container, unmount } = render(<Icon />);
  const drawing = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return drawing;
}

/** The menu item's own icon, found by its drawing; hidden from screen readers when it is decorative. */
function iconIn(item: HTMLElement, drawing: string): SVGSVGElement | undefined {
  return [...item.querySelectorAll("svg")].find(
    (icon) => icon.innerHTML === drawing,
  );
}

test('With a handler for it, the account menu holds "Zapnout upozornění" with the bell above "Odhlásit se", in the same style', async () => {
  const bell = drawingOf(Bell);
  const logOut = drawingOf(LogOut);
  expect(bell, "Lucide's bell draws something").not.toBe("");
  render(
    <AccountMenu
      account={LUCIE}
      onSignOut={() => {}}
      onEnableNotifications={() => {}}
    />,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));

  await screen.findByRole("menu");
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
    '"Zapnout upozornění" above "Odhlásit se", nothing else',
  ).toEqual(["Zapnout upozornění", "Odhlásit se"]);
  const enable = screen.getByRole("menuitem", { name: "Zapnout upozornění" });
  const signOut = screen.getByRole("menuitem", { name: "Odhlásit se" });
  expect(
    screen.getByRole("separator").compareDocumentPosition(enable) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "after the separator",
  ).toBeTruthy();
  const bellIcon = iconIn(enable, bell);
  const signOutIcon = iconIn(signOut, logOut);
  expect(bellIcon, "the bell in the item").toBeDefined();
  expect(
    bellIcon?.closest('[aria-hidden="true"]'),
    "the bell hidden from screen readers",
  ).not.toBeNull();
  expect(
    [bellIcon?.getAttribute("width"), bellIcon?.getAttribute("height")],
    'the bell the size of "Odhlásit se"\'s icon, 20 px',
  ).toEqual([
    signOutIcon?.getAttribute("width"),
    signOutIcon?.getAttribute("height"),
  ]);
  expect(signOutIcon?.getAttribute("width")).toBe("20");
});

test('Without a handler for it, the account menu holds the one item "Odhlásit se"', async () => {
  const { rerender } = render(
    <AccountMenu
      account={LUCIE}
      onSignOut={() => {}}
      onEnableNotifications={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));
  await screen.findByRole("menu");
  // A control step: with the handler, the item is there, so its absence below is the handler's doing.
  expect(
    screen.queryByRole("menuitem", { name: "Zapnout upozornění" }),
    "with the handler, the item shows",
  ).toBeInTheDocument();

  rerender(<AccountMenu account={LUCIE} onSignOut={() => {}} />);

  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
    'without it, the one item "Odhlásit se"',
  ).toEqual(["Odhlásit se"]);
});

// The item's handler asks the phone, as the app's does (c012 design.md D7): iOS asks only from a gesture, so the handler
// must run within the selection's own tap, which the test kit's watch on the push stand-ins tells (src/test/taps.ts).
test('Choosing "Zapnout upozornění" calls its handler within the selection and closes the menu', async () => {
  const phone = installPushStandIns({ permission: "default" });
  const questions = watchPermissionQuestions();
  render(
    <AccountMenu
      account={LUCIE}
      onSignOut={() => {}}
      onEnableNotifications={() => {
        void Notification.requestPermission();
      }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));

  await user.click(
    await screen.findByRole("menuitem", { name: "Zapnout upozornění" }),
  );

  expect(phone.permissionRequests(), "the handler called once").toBe(1);
  expect(questions.askedInTap(), "within the selection's tap").toEqual([true]);
  expect(screen.queryByRole("menu"), "the menu closes").not.toBeInTheDocument();
});

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
