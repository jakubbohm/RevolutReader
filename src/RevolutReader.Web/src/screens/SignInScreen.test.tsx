import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderApp } from "../test/renderApp";
import { nobodySignedIn } from "../test/server";

// The sign-in button after the visitor comes back from Microsoft's page with the browser's back button (c007, slice 13).
// A browser may restore the page from its back-forward cache, as it was when the visitor left: the button still busy,
// and ignoring taps. That return is a `pageshow` whose `persisted` is true, and the button must be ready again; a
// `pageshow` of a normal load (`persisted` false) changes nothing. Rendered as the app shows it when nobody is signed in.

const SIGN_IN = "Přihlásit se účtem Microsoft";

function showPage(persisted: boolean): void {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
  });
}

test("The sign-in button is ready again when the page comes back from the back-forward cache", async () => {
  const app = renderApp("iPhone Home Screen", {
    whoIsSignedIn: nobodySignedIn,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SIGN_IN }));
  expect(screen.getByRole("button", { name: SIGN_IN })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(app.navigations()).toEqual(["/api/auth/login"]);

  showPage(true);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: SIGN_IN })).not.toHaveAttribute(
      "aria-busy",
      "true",
    ),
  );
  await user.click(screen.getByRole("button", { name: SIGN_IN }));
  expect(app.navigations()).toEqual(["/api/auth/login", "/api/auth/login"]);
});

test("A page show of a normal load leaves a sign-in under way", async () => {
  const app = renderApp("iPhone Home Screen", {
    whoIsSignedIn: nobodySignedIn,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SIGN_IN }));

  showPage(false);

  expect(screen.getByRole("button", { name: SIGN_IN })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await user.click(screen.getByRole("button", { name: SIGN_IN }));
  expect(app.navigations()).toEqual(["/api/auth/login"]);
});
