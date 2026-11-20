import { Bell } from "lucide-react";
import type { JSX } from "react";
import type { CardState } from "../app/notificationOffer";
import { Button } from "./Button";

export interface NotificationOptInProps {
  /** The card's state, as the design names it. */
  state: CardState;
  /** "Zapnout upozornění": asks the phone, synchronously in the tap. */
  onEnable: () => void;
  /** "Teď ne". */
  onDismiss: () => void;
}

/**
 * The notification opt-in card (design system NotificationOptIn, c012 design.md D1): `color-surface` with a
 * `color-border` hairline, `radius-card`, `shadow-card`, `spacing-gutter` padding and the gutter as side margin. Its
 * head is a 40 pt disc and a `text-headline` title, then a muted `text-body` sentence. The default state: Lucide
 * `bell` on `color-accent-soft`, then the block primary "Zapnout upozornění" and the block ghost "Teď ne".
 */
export function NotificationOptIn({
  onEnable,
  onDismiss,
}: NotificationOptInProps): JSX.Element {
  return (
    <div className="mx-gutter flex flex-col gap-2 rounded-card border border-border bg-surface p-gutter shadow-card">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <Bell size={20} />
        </span>
        <p className="text-headline text-ink">Chceš vědět o každé platbě?</p>
      </div>
      <p className="text-body text-ink-muted">
        Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou.
      </p>
      <div className="mt-2 flex flex-col gap-1">
        <Button block onClick={onEnable}>
          Zapnout upozornění
        </Button>
        <Button variant="ghost" block onClick={onDismiss}>
          Teď ne
        </Button>
      </div>
    </div>
  );
}
