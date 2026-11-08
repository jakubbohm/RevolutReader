import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderApp } from "../test/renderApp";
import { refused, type SignOutAnswer } from "../test/server";

// "Zkusit jiný účet" on the no-access screen (c007, slices 15 and 13): it signs out, then starts a sign-in that asks
// Microsoft for its account picker. A sign-out that fails must not keep the visitor on this screen: the new sign-in
// replaces the old login anyway. And when the visitor comes back from Microsoft's page with the browser's back button,
// and the browser restores the page from its back-forward cache (`pageshow` with `persisted`), the button is ready
// again. Rendered as the app shows it for a refused account; the address is made up.

const TRY_ANOTHER_ACCOUNT = "Zkusit jiný účet";
const SIGN_OUT = "POST /api/auth/logout";
const SIGN_IN_WITH_THE_PICKER = "/api/auth/login?anotherAccount=true";
const STRANGER = refused("cizi.ucet@example.com");

function showPage(persisted: boolean): void {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
  });
}

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
  "A failed sign-out still starts the new sign-in: $label",
  async ({ signOut, end }) => {
    const app = renderApp("iPhone Home Screen", {
      whoIsSignedIn: STRANGER,
      signOut,
    });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: TRY_ANOTHER_ACCOUNT }),
    );

    await waitFor(() =>
      expect(app.navigations()).toEqual([SIGN_IN_WITH_THE_PICKER]),
    );
    const timeline = app.timeline();
    expect(timeline.indexOf(end), "the sign-out was tried").not.toBe(-1);
    expect(
      timeline.indexOf(`navigation ${SIGN_IN_WITH_THE_PICKER}`),
      "the new sign-in starts once the sign-out has failed",
    ).toBeGreaterThan(timeline.indexOf(end));
  },
);

test("The try-another-account button is ready again when the page comes back from the back-forward cache", async () => {
  const app = renderApp("iPhone Home Screen", { whoIsSignedIn: STRANGER });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: TRY_ANOTHER_ACCOUNT }),
  );
  await waitFor(() =>
    expect(app.navigations()).toEqual([SIGN_IN_WITH_THE_PICKER]),
  );
  expect(
    screen.getByRole("button", { name: TRY_ANOTHER_ACCOUNT }),
  ).toHaveAttribute("aria-busy", "true");

  showPage(true);

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: TRY_ANOTHER_ACCOUNT }),
    ).not.toHaveAttribute("aria-busy", "true"),
  );
  await user.click(screen.getByRole("button", { name: TRY_ANOTHER_ACCOUNT }));
  await waitFor(() =>
    expect(app.navigations()).toEqual([
      SIGN_IN_WITH_THE_PICKER,
      SIGN_IN_WITH_THE_PICKER,
    ]),
  );
  expect(app.requests().filter((request) => request === SIGN_OUT)).toHaveLength(
    2,
  );
});
