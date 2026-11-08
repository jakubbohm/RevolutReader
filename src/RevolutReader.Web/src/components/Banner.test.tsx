import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Banner } from "./Banner";

// The banner (design system Banner, c009 design.md D10): a warning is announced as a status and an error as an alert,
// the tone carried in the words and the role as well as the colour; its one action is a button under its text, which
// ignores taps while it loads. Read by role and text, as a user and a screen reader meet it.

test("A warning banner is announced as a status, an error banner as an alert", () => {
  const { unmount } = render(
    <Banner tone="warning" title="Příliš mnoho obnovení">
      Banka teď další dotazy nepřijímá. Zkus to znovu později.
    </Banner>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Příliš mnoho obnovení");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  unmount();

  render(
    <Banner tone="error" title="Banka teď neodpovídá">
      Zkus to prosím za chvíli.
    </Banner>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Banka teď neodpovídá");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("A banner's action is a button under its text, and a loading action ignores taps", async () => {
  let taps = 0;
  const retry = (): void => {
    taps += 1;
  };
  const { rerender } = render(
    <Banner
      tone="error"
      title="Banka teď neodpovídá"
      action={{ label: "Zkusit znovu", onClick: retry }}
    >
      Zkus to prosím za chvíli.
    </Banner>,
  );
  const user = userEvent.setup();

  const banner = screen.getByRole("alert");
  const action = within(banner).getByRole("button", { name: "Zkusit znovu" });
  expect(
    within(banner)
      .getByText("Zkus to prosím za chvíli.")
      .compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the button comes under the text",
  ).toBeTruthy();
  await user.click(action);
  expect(taps).toBe(1);

  rerender(
    <Banner
      tone="error"
      title="Banka teď neodpovídá"
      action={{ label: "Zkusit znovu", onClick: retry, loading: true }}
    >
      Zkus to prosím za chvíli.
    </Banner>,
  );
  await user.click(screen.getByRole("button", { name: "Zkusit znovu" }));
  expect(taps, "a loading action ignores the tap").toBe(1);
});
