import type { JSX } from "react";
import { startSignIn } from "../app/session";
import { useLeaving } from "../app/useLeaving";
import { MicrosoftSignInButton } from "../components/MicrosoftSignInButton";

export interface SignInScreenProps {
  /** Shown right after signing out from the account menu, with its note above the button (c007, slice 17). */
  signedOut: boolean;
}

/**
 * The screen when nobody is signed in (spec sign-in, laid out as the Screens board "Sign-in / Start", light and dark;
 * c007 design.md D12): no top bar; the app icon and its Spanish name with one line about the app, centred; the
 * Microsoft sign-in button and its muted line at the bottom, above the home-indicator inset. Tapping the button starts
 * the sign-in, and the button shows it is loading while the page leaves for Microsoft; a second tap does nothing. When
 * the visitor comes back with the browser's back button and the page is restored from the back-forward cache, the
 * button is ready again.
 */
export function SignInScreen(_props: SignInScreenProps): JSX.Element {
  const [leaving, setLeaving] = useLeaving();

  function signIn(): void {
    if (leaving) return;

    setLeaving(true);
    startSignIn();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background pt-[calc(env(safe-area-inset-top,0px)_+_var(--spacing-topbar))] pr-[calc(env(safe-area-inset-right,0px)_+_var(--spacing-gutter))] pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-section))] pl-[calc(env(safe-area-inset-left,0px)_+_var(--spacing-gutter))]">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <img
          src="/app-icon.svg"
          width={64}
          height={64}
          alt=""
          className="block size-16 rounded-card"
        />
        {/* The app's name is Spanish and stays so: never translated or truncated. */}
        <h1 className="text-title" lang="es">
          Tarjeta Papá
        </h1>
        <p className="text-body text-ink-muted">
          Uvidíš tu zůstatek a pohyby na tátově eurovém účtu.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <MicrosoftSignInButton onClick={signIn} loading={leaving} />
        <p className="text-footnote text-ink-muted">
          Použij účet Microsoft, který ti táta povolil.
        </p>
      </div>
    </main>
  );
}
