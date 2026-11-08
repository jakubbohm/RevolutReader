import type { Balance } from "./balance";

// The balance the phone keeps (c009 design.md D4). Stubs until c009 tasks.md group 29 is implemented; `void` keeps the
// unused-parameter check quiet until then.

/** The kept balance; `null` when there is none, it has the wrong shape, or the store fails. */
export function loadStoredBalance(): Promise<Balance | null> {
  throw new Error("not implemented");
}

/** Keeps this balance in place of the one before; a failure is ignored. */
export function storeBalance(balance: Balance): Promise<void> {
  void balance;
  throw new Error("not implemented");
}

/** Forgets the kept balance; a failure is ignored. */
export function forgetStoredBalance(): Promise<void> {
  throw new Error("not implemented");
}
