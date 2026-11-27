import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { balanceLook } from "./balanceLook";

// The test kit's own checks: the balance's look (./balanceLook.ts) reads the header's state as the spec says it.

/** A header as `BalanceHeader` writes its state (c019 design.md D9), with nothing else of it. */
function header(state: string | null): void {
  render(
    <section {...(state === null ? {} : { "data-balance": state })}>
      <h1>Na účtu máš</h1>
      <p>286,40 €</p>
    </section>,
  );
}

test.each([
  ["live", "ink"],
  ["waiting", "grey, moving"],
  ["stale", "grey, still"],
])("A header in the state %s shows the balance %s", (state, look) => {
  header(state);

  expect(balanceLook("286,40 €")).toBe(look);
});

test("A header with no state shows the balance with no look", () => {
  header(null);

  expect(balanceLook("286,40 €")).toBe("no look");
});

test("A header in another state fails the read", () => {
  header("shiny");

  expect(() => balanceLook("286,40 €")).toThrow(/"shiny"/);
});

test("An amount the screen does not show fails the read", () => {
  header("live");

  expect(() => balanceLook("250,00 €")).toThrow();
});
