import { Bell, BellOff, BellRing, type LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
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
 * The notification opt-in card (design system NotificationOptIn, c012 design.md D1), by its state:
 * - default: Lucide `bell` on `color-accent-soft`, "Chceš vědět o každé platbě?", then the block primary "Zapnout
 *   upozornění" and the block ghost "Teď ne";
 * - enabling: the same, the primary in its loading state and "Teď ne" disabled, while the phone asks and the app
 *   subscribes;
 * - enabled: `bell-ring` on `color-incoming-soft`, "Upozornění jsou zapnutá", no button, announced as a status;
 * - denied: `bell-off` on `color-surface-muted`, "Upozornění jsou vypnutá" and the path to the phone's Settings, no
 *   button (the web cannot ask again), announced as a status (D1, D6).
 */
export function NotificationOptIn({
  state,
  onEnable,
  onDismiss,
}: NotificationOptInProps): JSX.Element {
  if (state === "enabled")
    return (
      <Card
        status
        icon={BellRing}
        disc="bg-incoming-soft text-incoming"
        title="Upozornění jsou zapnutá"
        sentence="Když se na účtu něco změní, přijde ti upozornění."
      />
    );

  if (state === "denied")
    return (
      <Card
        status
        icon={BellOff}
        disc="bg-surface-muted text-ink-muted"
        title="Upozornění jsou vypnutá"
        sentence="Zapneš je v Nastavení → Oznámení → Tarjeta Papá."
      />
    );

  const enabling = state === "enabling";
  return (
    <Card
      icon={Bell}
      disc="bg-accent-soft text-accent"
      title="Chceš vědět o každé platbě?"
      sentence="Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou."
    >
      <div className="mt-2 flex flex-col gap-1">
        <Button block loading={enabling} onClick={onEnable}>
          Zapnout upozornění
        </Button>
        <Button variant="ghost" block disabled={enabling} onClick={onDismiss}>
          Teď ne
        </Button>
      </div>
    </Card>
  );
}

interface CardProps {
  /** Announced as a status, for a result. */
  status?: boolean;
  /** The Lucide icon in the disc. */
  icon: LucideIcon;
  /** The disc's fill and the icon's colour. */
  disc: string;
  title: string;
  sentence: string;
  /** The buttons, under the sentence. */
  children?: ReactNode;
}

/**
 * The card every state shares: `color-surface` with a `color-border` hairline, `radius-card`, `shadow-card`,
 * `spacing-gutter` padding and the gutter as side margin; its head a 40 pt disc with a 20 px icon, hidden from screen
 * readers, and the `text-headline` title; then the muted `text-body` sentence.
 */
function Card({
  status = false,
  icon: Icon,
  disc,
  title,
  sentence,
  children,
}: CardProps): JSX.Element {
  return (
    <div
      role={status ? "status" : undefined}
      className="mx-gutter flex flex-col gap-2 rounded-card border border-border bg-surface p-gutter shadow-card"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-10 flex-none items-center justify-center rounded-full ${disc}`}
        >
          <Icon size={20} />
        </span>
        <p className="text-headline text-ink">{title}</p>
      </div>
      <p className="text-body text-ink-muted">{sentence}</p>
      {children}
    </div>
  );
}
