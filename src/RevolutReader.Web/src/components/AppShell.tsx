import type { JSX, ReactNode } from "react";
import { AccountMenu, type Account } from "./AccountMenu";

export interface AppShellProps {
  /** Who is signed in: the top bar then holds the account menu. Without one, the empty frame has no menu. */
  account?: Account;
  /** "Odhlásit se" in the account menu. */
  onSignOut?: () => void;
  /** The screen's content, stacked with the design's section gaps. */
  children?: ReactNode;
}

/**
 * The frame of every screen (design system AppShell, c003 design.md D4, c007 D12): the side safe-area insets, the sticky
 * top bar below the status-bar inset with the app name and, for a signed-in user, the account menu, and the content
 * area above the home-indicator inset. The top bar is opaque, so content never shows through the status-bar strip.
 */
export function AppShell({
  account,
  onSignOut,
  children,
}: AppShellProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)]">
      <header className="sticky top-0 z-20 bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex h-topbar items-center justify-between pr-1 pl-gutter">
          {/* The app's name is Spanish and stays so: never translated or truncated. */}
          <span className="text-headline text-ink" lang="es">
            Tarjeta Papá
          </span>
          {account ? (
            <AccountMenu account={account} onSignOut={onSignOut} />
          ) : null}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-section pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-section))]">
        {children}
      </main>
    </div>
  );
}
