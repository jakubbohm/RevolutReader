import { notificationOffer, type Offer } from "./notificationOffer";
import { pushSupported } from "./push";

export interface NotificationOptInModel extends Offer {
  /** The card's "Zapnout upozornění": asks synchronously (turnNotificationsOn), the card enabling until the outcome. */
  turnOn(): void;
  /** "Teď ne": remembered (rememberNotNow), the card gone. */
  notNow(): void;
  /** The menu's item: blocked → the Denied card, asking nothing; otherwise as turnOn, synchronously in onSelect. */
  fromMenu(): void;
}

export interface NotificationOptInOptions {
  /** The server named a signed-in user (the account menu shows). */
  signedIn: boolean;
  /** The balance header, or its placeholder, is on screen. */
  underBalance: boolean;
  /** A failed turn-on, for the screen's one banner (D8). */
  onFailed: (offline: boolean) => void;
  /** A new turn-on, clearing that failure (D8). */
  onRetried: () => void;
}

/**
 * The opt-in's sequence (c012 design.md D3–D8): what is offered (`notificationOffer`) from whether the browser can
 * subscribe (`pushSupported`, C8a), the phone's permission, the signed-in user and the balance header.
 */
export function useNotificationOptIn({
  signedIn,
  underBalance,
}: NotificationOptInOptions): NotificationOptInModel {
  const supported = pushSupported(window);
  const offer = notificationOffer({
    supported,
    signedIn,
    underBalance,
    permission: supported ? Notification.permission : "default",
    notNow: false,
    step: "idle",
  });

  return { ...offer, turnOn: ignore, notNow: ignore, fromMenu: ignore };
}

/** What a tap does until its own slice builds it. */
function ignore(): void {}
