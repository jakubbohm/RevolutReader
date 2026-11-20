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

// While turning on and once on in this opening (D3, D4), with the balance header on screen; without it, see below.

test("While turning on, the enabling card and no menu item", () => {
  // The phone still asking, and the phone allowing while the app subscribes.
  for (const permission of ["default", "granted"] as const) {
    expect(
      notificationOffer(facts({ step: "enabling", permission })),
      `the permission ${permission}`,
    ).toEqual({ card: "enabling", menuItem: false });
  }
});

test("Once on in this opening, the enabled card and no menu item", () => {
  expect(
    notificationOffer(facts({ step: "enabled", permission: "granted" })),
  ).toEqual({ card: "enabled", menuItem: false });
});

// Once on (D8, "On": the phone allows notifications), at an opening with no result of its own; that a failure in this
// opening still shows the default card is task 34.3's.

test("A phone that allows notifications is offered nothing, card or menu item, when no result of this opening shows", () => {
  for (const changes of WOULD_OFFER) {
    expect(
      notificationOffer(
        facts({ ...changes, permission: "granted", step: "idle" }),
      ),
    ).toEqual(NOTHING);
  }
});

// Declining (D6) and a blocked phone (D7: the web cannot ask again, so the account menu offers to say where to turn
// them on). A Denied card without the header: see below.

test("After a decline in this opening, the Denied card and no menu item", () => {
  expect(
    notificationOffer(facts({ step: "denied", permission: "denied" })),
  ).toEqual({ card: "denied", menuItem: false });
});

test("A blocked phone with no result of this opening is offered the menu item, never a card", () => {
  for (const underBalance of [true, false]) {
    for (const notNow of [false, true]) {
      expect(
        notificationOffer(
          facts({ permission: "denied", step: "idle", underBalance, notNow }),
        ),
        `the balance header ${underBalance ? "on screen" : "not on screen"}, "Teď ne" ${notNow ? "remembered" : "not remembered"}`,
      ).toEqual({ card: null, menuItem: true });
    }
  }
});

// "Teď ne" remembered on the device (D5): the card does not come back by itself; the account menu offers instead (D7).

test('With "Teď ne" remembered, no card and the menu item', () => {
  expect(notificationOffer(facts({ notNow: true }))).toEqual({
    card: null,
    menuItem: true,
  });
});

// A turn-on from the menu (D2, D7): the step under way and the result of this opening show in the card, wherever the
// screen is, and the menu offers nothing meanwhile.

/** A step under way or a result of this opening, with a permission it comes with, and the card it shows. */
const RESULTS = [
  { step: "enabling", permission: "default", card: "enabling" },
  { step: "enabling", permission: "granted", card: "enabling" },
  { step: "enabled", permission: "granted", card: "enabled" },
  { step: "denied", permission: "denied", card: "denied" },
] as const;

test('With "Teď ne" remembered, a turn-on from the menu shows its step and its result in the card, and no menu item', () => {
  for (const { step, permission, card } of RESULTS) {
    expect(
      notificationOffer(facts({ notNow: true, step, permission })),
      `the step ${step}, the permission ${permission}`,
    ).toEqual({ card, menuItem: false });
  }
});

test("A result of this opening shows whether or not the balance header is on screen", () => {
  for (const { step, permission, card } of RESULTS) {
    for (const underBalance of [true, false]) {
      for (const notNow of [false, true]) {
        expect(
          notificationOffer(facts({ step, permission, underBalance, notNow })),
          `the step ${step}, the permission ${permission}, the balance header ${underBalance ? "on screen" : "not on screen"}, "Teď ne" ${notNow ? "remembered" : "not remembered"}`,
        ).toEqual({ card, menuItem: false });
      }
    }
  }
});
