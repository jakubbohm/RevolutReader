import type { JSX } from "react";
import { useTransactionList } from "../app/useTransactionList";
import type { Account } from "../components/AccountMenu";
import { AppShell } from "../components/AppShell";
import { Skeleton } from "../components/Skeleton";
import { TransactionList } from "../components/TransactionList";

export interface AccountScreenProps {
  /** The signed-in user, as the server names them; none until the server has answered, or when its answer is unknown. */
  account?: Account;
  /** "Odhlásit se" in the account menu (c007, slice 17). */
  onSignOut?: () => void;
}

/**
 * The app's own screen (c007 design.md D5, D12): the frame, whose content area holds the transaction list until it
 * joins C7a's screen (c010 design.md D7, D8). For a signed-in, allowed user its top bar holds the account menu, and the
 * list reads the newest transactions; before the server's answer, or when the answer is unknown, it is the empty frame
 * without the menu, and nothing is read. One screen for both, so the top bar stays in place when the answer comes and
 * only the menu and the list join it.
 */
export function AccountScreen({
  account,
  onSignOut,
}: AccountScreenProps): JSX.Element {
  // The server names the account only once it has said who is signed in (App).
  const list = useTransactionList({ enabled: account !== undefined });

  return (
    <AppShell account={account} onSignOut={onSignOut}>
      {list.shown.body === "placeholder" ? <Skeleton variant="list" /> : null}
      {list.shown.body === "list" ? (
        <TransactionList list={list.shown.list} rate={list.shown.rate} />
      ) : null}
    </AppShell>
  );
}
