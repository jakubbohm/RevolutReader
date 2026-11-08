import { WifiOff } from "lucide-react";
import type { JSX } from "react";
import type { Problem, ShownAccount } from "../app/screenState";
import { useNow } from "../app/useNow";
import { AppShell } from "../components/AppShell";
import { BalanceHeader } from "../components/BalanceHeader";
import { Banner } from "../components/Banner";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { WakingUp } from "../components/WakingUp";

/** How often the freshness line counts again (c009 design.md D10). */
const MINUTE_MS = 60_000;

export interface AccountScreenProps {
  /** What the account screen shows (`shown`). */
  shown: ShownAccount;
  /** "Obnovit" in the balance header. */
  onRefresh: () => void;
  /** "Zkusit znovu" in a banner. */
  onRetry: () => void;
  /** "Odhlásit se" in the account menu. */
  onSignOut: () => void;
}

/**
 * The app's own screen (c007 design.md D5, D12; c009 D2, D7, D10), as `shown` says: the frame, with the account menu
 * once the server named the user; under the top bar the balance header, or its placeholder while the first read runs;
 * then the screen's one banner; then the list slot, empty until C7b's list fills it, or the offline note or the waking-up
 * screen in its place. Without a header it is the empty frame, so the top bar stays in place while the answers come;
 * with nothing to show, offline or the waking-up screen is the whole screen. The freshness line counts again every
 * minute.
 */
export function AccountScreen({
  shown,
  onRefresh,
  onRetry,
  onSignOut,
}: AccountScreenProps): JSX.Element {
  const now = useNow(MINUTE_MS);
  const { header } = shown;
  const banner =
    shown.banner === null ? null : bannerFor(shown.banner, onRetry);

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
      {banner !== null ? (
        // Alone under the top bar, the banner keeps a little distance from it (the board "Error – bank unavailable, no data").
        <div className={header === null ? "px-gutter pt-2" : "px-gutter"}>
          {banner}
        </div>
      ) : null}
      {shown.body === "offline note" ? (
        <EmptyState variant="note">
          Pohyby se načtou, jakmile budeš online.
        </EmptyState>
      ) : null}
      {shown.body === "offline" ? <OfflineScreen /> : null}
      {shown.body === "waking" || shown.body === "waking slow" ? (
        // Under a stored header in the list's place, or the whole screen under the top bar with nothing stored.
        <div className={header === null ? "px-gutter pt-16" : "px-gutter"}>
          <WakingUp slow={shown.body === "waking slow"} onRetry={onRetry} />
        </div>
      ) : null}
    </AppShell>
  );
}

/**
 * The screen's one banner, by its problem (c009 design.md D5, D7 c):
 * - offline (the board "Shell / Offline / Balance stored"): the warning with `wifi-off`, "Jsi offline" and "Zkusit
 *   znovu", and no sentence, since the freshness line already says how old the balance is;
 * - the bank does not answer: the error "Banka teď neodpovídá" with "Zkusit znovu", which reads the balance again;
 * - the bank's limit is reached: the warning "Příliš mnoho obnovení", with no action, since trying again would not help;
 * - the bank access expired: the error "Propojení s bankou vypršelo", with no action, since only Dad can renew it;
 * - any answer the app cannot read, to who is signed in or to the balance read: the error "Zůstatek se nepodařilo
 *   načíst" with "Zkusit znovu", which repeats what failed (D5 b).
 *
 * The failed sign-out's banner comes with its own slice (c009 tasks.md slice 27).
 */
function bannerFor(problem: Problem, onRetry: () => void): JSX.Element | null {
  const retry = { label: "Zkusit znovu", onClick: onRetry };

  switch (problem.kind) {
    case "offline":
      return (
        <Banner
          tone="warning"
          icon="wifi-off"
          title="Jsi offline"
          action={retry}
        />
      );
    case "bank unavailable":
      return (
        <Banner tone="error" title="Banka teď neodpovídá" action={retry}>
          Zkus to prosím za chvíli.
        </Banner>
      );
    case "bank rate limited":
      return (
        <Banner tone="warning" title="Příliš mnoho obnovení">
          Banka teď další dotazy nepřijímá. Zkus to znovu později.
        </Banner>
      );
    case "bank access expired":
      return (
        <Banner tone="error" title="Propojení s bankou vypršelo">
          Obnovit propojení musí táta, dej mu prosím vědět.
        </Banner>
      );
    case "unexpected":
      return (
        <Banner
          tone="error"
          title="Zůstatek se nepodařilo načíst"
          action={retry}
        >
          Zkus to prosím za chvíli.
        </Banner>
      );
    case "sign-out failed":
      return null;
  }
}

/**
 * Offline with nothing to show: the whole screen under the top bar, with no header and no banner (app-shell; the Screens
 * board "Shell / Offline / Nothing stored"), announced as a status.
 */
function OfflineScreen(): JSX.Element {
  return (
    <div role="status" className="flex flex-col items-center pt-16">
      <EmptyState icon={WifiOff} title="Jsi offline">
        Zůstatek a pohyby se načtou, jakmile budeš online.
      </EmptyState>
    </div>
  );
}
