import type { JSX } from "react";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

export interface NoAccessScreenProps {
  /** The refused account's own email address, as the server names it; `null` when it names none. */
  email: string | null;
  /** "Zkusit jiný účet": signs out and starts a sign-in that asks Microsoft for its account picker (c007, slice 15). */
  onTryAnotherAccount?: () => void;
}

/** What the screen asks of a refused visitor, whether or not the server named the account. */
const USE_THE_ALLOWED_ACCOUNT = "Přihlas se tím, který ti táta povolil.";

/**
 * The screen for a signed-in account that is not on the allowlist (spec sign-in, laid out as the Screens board "Sign-in
 * / Access denied"; c007 design.md D3, D12): no top bar; the app icon and its Spanish name, then the error banner that
 * names the account; at the bottom the button to try another account, with a muted line under it. Without an email
 * address, the banner keeps its title and only asks for the allowed account.
 */
export function NoAccessScreen({
  email,
  onTryAnotherAccount,
}: NoAccessScreenProps): JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col gap-section bg-background pt-[calc(env(safe-area-inset-top,0px)_+_var(--spacing-topbar))] pr-[env(safe-area-inset-right,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-section))] pl-[env(safe-area-inset-left,0px)]">
      <div className="flex flex-1 flex-col justify-center gap-section">
        <div className="flex flex-col items-center gap-3 px-gutter text-center">
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
        </div>
        <div className="px-gutter">
          <Banner tone="error" title="Tenhle účet nemá přístup">
            {email === null
              ? USE_THE_ALLOWED_ACCOUNT
              : `Účet ${email} tu není povolený. ${USE_THE_ALLOWED_ACCOUNT}`}
          </Banner>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 px-gutter text-center">
        <Button block onClick={onTryAnotherAccount}>
          Zkusit jiný účet
        </Button>
        <p className="text-footnote text-ink-muted">
          Nevíš, který to je? Zeptej se táty.
        </p>
      </div>
    </main>
  );
}
