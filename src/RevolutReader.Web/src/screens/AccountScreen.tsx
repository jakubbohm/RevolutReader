import type { JSX } from "react";
import type { ShownAccount } from "../app/screenState";
import { useNow } from "../app/useNow";
import { AppShell } from "../components/AppShell";
import { BalanceHeader } from "../components/BalanceHeader";
import { Skeleton } from "../components/Skeleton";

/** How often the freshness line counts again (c009 design.md D10). */
const MINUTE_MS = 60_000;

export interface AccountScreenProps {
  /** What the account screen shows (`shown`). */
  shown: ShownAccount;
  /** "Obnovit" in the balance header. */
  onRefresh: () => void;
  /** "Odhlásit se" in the account menu. */
  onSignOut: () => void;
}

/**
 * The app's own screen (c007 design.md D5, D12; c009 D2, D7, D10), as `shown` says: the frame, with the account menu
 * once the server named the user; under the top bar the balance header, or its placeholder while the first read runs;
 * then the list slot, empty until C7b's list fills it. Without a header it is the empty frame, so the top bar stays in
 * place while the answers come. The freshness line counts again every minute.
 */
export function AccountScreen({
  shown,
  onRefresh,
  onSignOut,
}: AccountScreenProps): JSX.Element {
  const now = useNow(MINUTE_MS);
  const { header } = shown;

  return (
    <AppShell account={shown.account ?? undefined} onSignOut={onSignOut}>
      {header === "placeholder" ? (
        <Skeleton variant="balance" />
      ) : header !== null ? (
        <BalanceHeader
          amount={header.balance.amount}
          rate={header.balance.czkPerEur}
          readAt={new Date(header.balance.readAt)}
          now={now}
          refreshing={header.refreshing}
          onRefresh={onRefresh}
        />
      ) : null}
    </AppShell>
  );
}
