import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CircleUserRound, LogOut } from "lucide-react";
import type { JSX } from "react";

/** Who is signed in, as the server names them (c007 design.md D3). */
export interface Account {
  name: string;
  email: string;
}

export interface AccountMenuProps {
  account: Account;
  /** "Odhlásit se": ends the login on this device (c007, slice 17). */
  onSignOut?: () => void;
}

/**
 * The top bar's account menu (design system AppShell, c007 design.md D12), a Radix `DropdownMenu` that leaves the page
 * unlocked (`modal={false}`): the trigger is a ghost icon button, 44 × 44 and round, with `circle-user-round` at 24 px,
 * labelled "Účet a odhlášení"; the menu holds the label "Přihlášený účet", the name and the email (cut with an ellipsis
 * when long), a separator, and one item, "Odhlásit se" with `log-out`, 44 pt tall. Nothing else goes in this menu. It
 * fades in over `duration-fast`, also under reduced motion (a fade, not a movement). Keyboard, VoiceOver, Escape and a
 * tap outside work through Radix.
 */
export function AccountMenu({
  account,
  onSignOut,
}: AccountMenuProps): JSX.Element {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label="Účet a odhlášení"
        className="inline-flex size-touch items-center justify-center rounded-full text-accent transition-transform duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] active:bg-accent-soft motion-reduce:transition-none motion-reduce:active:scale-100"
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
            <span className="text-body-strong">{account.name}</span>
            <span className="truncate text-footnote text-ink-muted">
              {account.email}
            </span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={onSignOut}
            className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control px-3 text-body outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-[highlighted]:bg-surface-muted"
          >
            <LogOut size={20} aria-hidden="true" />
            Odhlásit se
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
