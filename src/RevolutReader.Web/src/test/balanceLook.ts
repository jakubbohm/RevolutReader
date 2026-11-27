import { screen } from "@testing-library/react";

/**
 * How the account screen's balance looks, in the spec's words (spec account-balance; c019 design.md D8, D12): "ink"
 * once the server confirmed it, "grey, moving" while a request that can confirm it is under way, "grey, still"
 * otherwise. jsdom draws nothing, so the look is read from the header's state, which `BalanceHeader` writes as
 * `data-balance` on its section (`live`, `waiting`, `stale`; design.md D9), and never from a class.
 */
export type BalanceLook = "ink" | "grey, moving" | "grey, still";

/** The look each state of the header shows (design.md D8, D9). */
const LOOKS: Readonly<Record<string, BalanceLook>> = {
  live: "ink",
  waiting: "grey, moving",
  stale: "grey, still",
};

/**
 * How the balance `amount` (as the screen shows it, e.g. "286,40 €") looks: the look of the header that shows it.
 * Fails when the screen shows no such amount, or not exactly once; `"no look"` when the header shows it with no state
 * (as before c019, or a placeholder). A state other than the three fails, naming it.
 */
export function balanceLook(amount: string): BalanceLook | "no look" {
  const shown = screen.getByText(amount);
  const header = shown.closest("[data-balance]");
  if (header === null) return "no look";
  const state = header.getAttribute("data-balance") ?? "";
  const look = LOOKS[state];
  if (look === undefined)
    throw new Error(
      `The header showing ${amount} has the state "${state}", none of live, waiting and stale.`,
    );
  return look;
}
