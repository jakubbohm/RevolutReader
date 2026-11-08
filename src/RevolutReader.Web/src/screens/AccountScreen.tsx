import type { JSX } from "react";
import type { Account } from "../components/AccountMenu";
import { AppShell } from "../components/AppShell";

export interface AccountScreenProps {
  /** The signed-in user, as the server names them; none until the server has answered, or when its answer is unknown. */
  account?: Account;
  /** "Odhlásit se" in the account menu (c007, slice 17). */
  onSignOut?: () => void;
}

/**
 * The app's own screen (c007 design.md D5, D12): the frame with an empty content area, which C7 fills with the balance
 * and the transactions. For a signed-in, allowed user its top bar holds the account menu; before the server's answer,
 * or when the answer is unknown, it is the empty frame without the menu. One screen for both, so the top bar stays in
 * place when the answer comes and only the menu joins it.
 */
export function AccountScreen({
  account,
  onSignOut,
}: AccountScreenProps): JSX.Element {
  return <AppShell account={account} onSignOut={onSignOut} />;
}
