import { expect, test } from "vitest";
import {
  notificationOffer,
  type Offer,
  type OfferFacts,
} from "./notificationOffer";

// What is offered (c012 design.md D2, D7): the card under the balance, the account menu's item, or nothing. Plain
// facts in, the offer out.

/**
 * The facts of a signed-in user on a browser that can subscribe, never asked, with the balance header on screen and
 * nothing under way in this opening, changed by `changes`.
 */
function facts(changes: Partial<OfferFacts>): OfferFacts {
  return {
    supported: true,
    signedIn: true,
    underBalance: true,
    permission: "default",
    notNow: false,
    step: "idle",
    ...changes,
  };
}

const NOTHING: Offer = { card: null, menuItem: false };

/** Situations that, on a browser that can subscribe with a signed-in user, offer the card or the menu item. */
const WOULD_OFFER: Partial<OfferFacts>[] = [
  {},
  { underBalance: false },
  { notNow: true },
  { permission: "denied" },
];

test("A browser that cannot subscribe is offered nothing, card or menu item", () => {
  for (const changes of WOULD_OFFER) {
    expect(notificationOffer(facts({ ...changes, supported: false }))).toEqual(
      NOTHING,
    );
  }
});

test("Nobody signed in is offered nothing", () => {
  for (const changes of WOULD_OFFER) {
    expect(notificationOffer(facts({ ...changes, signedIn: false }))).toEqual(
      NOTHING,
    );
  }
});

test("A signed-in user never asked, with the balance on screen, gets the default card and no menu item", () => {
  expect(notificationOffer(facts({}))).toEqual({
    card: "default",
    menuItem: false,
  });
});

test("Without the balance header, the default card is not shown and the menu item is", () => {
  expect(notificationOffer(facts({ underBalance: false }))).toEqual({
    card: null,
    menuItem: true,
  });
});
