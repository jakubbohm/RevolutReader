/**
 * What is offered (c012 design.md D2, D7, D8): the card under the balance, the account menu's "Zapnout upozornění", or
 * nothing. Pure, so the card, the menu item and the screen never disagree.
 */

/** The card's state, as the design names it. */
export type CardState = "default" | "enabling" | "enabled" | "denied";

/** Where turning on stands in this opening (D3, D4, D8). */
export type Step = "idle" | "enabling" | "enabled" | "denied" | "failed";

export interface OfferFacts {
  /** pushSupported (C8a): a service worker, PushManager and Notification. */
  supported: boolean;
  /** The server named a signed-in user (the menu shows). */
  signedIn: boolean;
  /** The balance header, or its placeholder, is on screen. */
  underBalance: boolean;
  /** Notification.permission, read at every opening. */
  permission: NotificationPermission;
  /** "Teď ne" remembered on the device (D5). */
  notNow: boolean;
  step: Step;
}

export interface Offer {
  /** The card to show, or none. */
  card: CardState | null;
  /** Whether the account menu holds "Zapnout upozornění". */
  menuItem: boolean;
}

/**
 * What is offered (D2, D7, D8). Not supported or not signed in: nothing. A step under way or a result of this
 * opening: its card (enabling, enabled, denied; default after a failure), wherever the screen is, and no menu item.
 * Otherwise: allowed → nothing; blocked → the menu item; never asked → the default card under the balance, unless
 * "Teď ne" is remembered or there is no balance header, then the menu item.
 */
export function notificationOffer(facts: OfferFacts): Offer {
  if (!facts.supported || !facts.signedIn) {
    return NOTHING;
  }
  const result = cardOfStep(facts.step);
  if (result !== null && facts.underBalance) {
    return { card: result, menuItem: false };
  }
  if (facts.permission === "granted") {
    return NOTHING;
  }
  if (facts.permission === "denied" || facts.notNow || !facts.underBalance) {
    return MENU_ITEM;
  }
  return { card: "default", menuItem: false };
}

/** The card a step under way or a result of this opening shows, or `null` when it shows none of its own. */
function cardOfStep(step: Step): CardState | null {
  switch (step) {
    case "enabling":
    case "enabled":
    case "denied":
      return step;
    default:
      return null;
  }
}

const NOTHING: Offer = { card: null, menuItem: false };

const MENU_ITEM: Offer = { card: null, menuItem: true };
