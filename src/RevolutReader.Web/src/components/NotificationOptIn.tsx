import type { JSX } from "react";
import type { CardState } from "../app/notificationOffer";

export interface NotificationOptInProps {
  /** The card's state, as the design names it. */
  state: CardState;
  /** "Zapnout upozornění": asks the phone, synchronously in the tap. */
  onEnable: () => void;
  /** "Teď ne". */
  onDismiss: () => void;
}

/** The notification opt-in card (design system NotificationOptIn, c012 design.md D1). */
export function NotificationOptIn(props: NotificationOptInProps): JSX.Element {
  void props;
  throw new Error("Not implemented");
}
