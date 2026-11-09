import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CircleUserRound, LoaderCircle, LogOut } from "lucide-react";
import { useState, type JSX } from "react";

/** Who is signed in, as the server names them (c007 design.md D3). */
export interface Account {
  name: string;
  email: string;
}

export interface AccountMenuProps {
  account: Account;
  /**
   * "Odhlásit se": ends the login on this device (c007, slice 17). When it returns a promise, the menu stays open until
   * it settles (c009 design.md D6).
   */
  onSignOut?: () => void | Promise<void>;
  /** A sign-out is under way: "Odhlásit se" is busy and ignores taps, and the menu stays open (c009 design.md D6). */
  signingOut?: boolean;
}

/**
 * The top bar's account menu (design system AppShell, c007 design.md D12), a Radix `DropdownMenu` that leaves the page
 * unlocked (`modal={false}`): the trigger is a ghost icon button, 44 × 44 and round, with `circle-user-round` at 24 px,
 * labelled "Účet a odhlášení"; the menu holds the label "Přihlášený účet", the name in full (a word too long for the
 * line breaks inside it) and the email, cut with an ellipsis when long, a separator, and one item, "Odhlásit se" with
 * `log-out`, 44 pt tall. Nothing else goes in this menu. It fades in over `duration-fast`, also under reduced motion (a
 * fade, not a movement). Keyboard, VoiceOver, Escape and a tap outside work through Radix.
 *
 * While the sign-out runs (c009 design.md D6), the menu stays open and "Odhlásit se" is busy: the spinner in place of
 * its icon, beside the kept label, `aria-busy`, taps ignored. A tap outside still closes the menu, and the sign-out goes
 * on; when it ends, the menu closes.
 */
export function AccountMenu({
  account,
  onSignOut,
  signingOut = false,
}: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);

  function selectSignOut(event: Event): void {
    // Without a handler, nothing runs, and the menu closes as any menu does.
    if (onSignOut === undefined) return;

    event.preventDefault();
    if (signingOut) return;

    const close = (): void => {
      setOpen(false);
    };
    void Promise.resolve(onSignOut()).then(close, close);
  }

  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        aria-label="Účet a odhlášení"
        className="inline-flex size-touch items-center justify-center rounded-full text-accent transition-[transform,background-color] duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] active:bg-accent-soft motion-reduce:active:scale-100"
      >
        <CircleUserRound size={24} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="z-30 flex max-w-[min(320px,calc(100vw-24px))] min-w-62 animate-fade-in flex-col rounded-card border border-border bg-surface p-1.5 text-ink shadow-menu"
        >
          <DropdownMenu.Label className="flex min-w-0 flex-col px-3 py-2">
            <span className="text-footnote text-ink-muted">
              Přihlášený účet
            </span>
            <span className="text-body-strong wrap-anywhere">
              {account.name}
            </span>
            <span className="truncate text-footnote text-ink-muted">
              {account.email}
            </span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={selectSignOut}
            aria-busy={signingOut || undefined}
            className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control px-3 text-body outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus data-[highlighted]:bg-surface-muted aria-busy:cursor-progress"
          >
            {signingOut ? (
              <LoaderCircle
                size={20}
                aria-hidden="true"
                className="animate-busy-spin"
              />
            ) : (
              <LogOut size={20} aria-hidden="true" />
            )}
            Odhlásit se
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
