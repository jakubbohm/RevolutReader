import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderApp } from "../test/renderApp";
import { signedIn, type SignOutAnswer } from "../test/server";

// "Odhlásit se" in the account menu (c007, slice 17): only a sign-out the server confirmed shows the signed-out screen.
// When it fails (a server error, offline), the visitor stays on the account screen, still signed in, with the account
// menu and without the note that the sign-out happened. Rendered as the app shows it for Lucie; the address is made up.

const SIGN_OUT = "POST /api/auth/logout";

const failedSignOuts: { label: string; signOut: SignOutAnswer; end: string }[] =
  [
    {
      label: "a server error",
      signOut: { kind: "server error" },
      end: `answer ${SIGN_OUT}`,
    },
    {
      label: "no answer, offline",
      signOut: { kind: "no connection" },
      end: `failure ${SIGN_OUT}`,
    },
  ];

test.each(failedSignOuts)(
  "A failed sign-out from the account menu leaves the account screen as it was: $label",
  async ({ signOut, end }) => {
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: signedIn("Lucie Nováková", "lucie@example.com"),
      signOut,
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Účet a odhlášení" }),
    );

    await user.click(
      await screen.findByRole("menuitem", { name: "Odhlásit se" }),
    );

    await waitFor(() => expect(app.timeline()).toContain(end));
    // The app takes in the failed answer: everything it does with it is queued before the next task.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(
      screen.getByRole("button", { name: "Účet a odhlášení" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Přihlásit se účtem Microsoft" }),
    ).not.toBeInTheDocument();
  },
);
