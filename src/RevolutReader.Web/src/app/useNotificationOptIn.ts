import { useCallback, useEffect, useRef, useState } from "react";
import { notificationOffer, type Offer, type Step } from "./notificationOffer";
import { pushSupported } from "./push";
import { turnNotificationsOn, type TurnOnOutcome } from "./turnOn";

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
 * subscribe (`pushSupported`, C8a), the phone's permission, the signed-in user, the balance header and the step of
 * this opening. The card's "Zapnout upozornění" asks the phone within the tap (D3) and shows the card enabling until
 * the outcome.
 */
export function useNotificationOptIn({
  signedIn,
  underBalance,
}: NotificationOptInOptions): NotificationOptInModel {
  const [step, setStep] = useState<Step>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const turnOn = useCallback((): void => {
    // First, synchronously in the tap: iOS asks for permission only from a gesture (D3).
    const turning = turnNotificationsOn();
    setStep("enabling");
    void turning.then((outcome) => {
      // A sign-out or a closed app ended the screen meanwhile: nothing left to show it on.
      if (mounted.current) setStep(stepAfter(outcome));
    });
  }, []);

  const supported = pushSupported(window);
  const offer = notificationOffer({
    supported,
    signedIn,
    underBalance,
    permission: supported ? Notification.permission : "default",
    notNow: false,
    step,
  });

  return { ...offer, turnOn, notNow: ignore, fromMenu: ignore };
}

/**
 * The step a turn-on ends in (D3): on → enabled; undecided → back as it was, with no banner. Declined (D6) and failed
 * (D8) are, for now, back as it was too.
 */
function stepAfter(outcome: TurnOnOutcome): Step {
  return outcome.kind === "on" ? "enabled" : "idle";
}

/** What a tap does until its own slice builds it. */
function ignore(): void {}
