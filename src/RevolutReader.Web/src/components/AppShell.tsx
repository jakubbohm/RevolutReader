import type { JSX, ReactNode } from "react";

export interface AppShellProps {
  /** The screen's content, stacked with the design's section gaps. */
  children?: ReactNode;
}

/**
 * The frame of every screen (design system AppShell, c003 design.md D4): the side safe-area insets, the sticky top bar
 * below the status-bar inset with the app name, and the content area above the home-indicator inset. The top bar is
 * opaque, so content never shows through the status-bar strip. The account menu joins it with the sign-in (C6).
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)]">
      <header className="sticky top-0 z-20 bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex h-topbar items-center justify-between pr-1 pl-gutter">
          {/* The app's name is Spanish and stays so: never translated or truncated. */}
          <span className="text-headline text-ink" lang="es">
            Tarjeta Papá
          </span>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-section pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-section))]">
        {children}
      </main>
    </div>
  );
}
