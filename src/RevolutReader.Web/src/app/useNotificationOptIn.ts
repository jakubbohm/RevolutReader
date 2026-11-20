import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { notificationOffer, type Offer, type Step } from "./notificationOffer";
import { notNowRemembered, rememberNotNow } from "./notNow";
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
 *
 * An opening (D4) is the launch, or a return to the app (`visibilitychange` to visible), never coming back online. At
 * every opening the permission is read again; a result of this opening (enabled, denied, the default card after a
 * failure) goes at the first return after the app was left while it showed, so the return that follows the phone's
 * own question leaves the result it is about to show. "Teď ne" is remembered on the device and read at every opening
 * (D5).
 */
export function useNotificationOptIn({
  signedIn,
  underBalance,
  onFailed,
  onRetried,
}: NotificationOptInOptions): NotificationOptInModel {
  const [step, setStep] = useState<Step>("idle");
  const [permission, setPermission] = useState(readPermission);
  // Read synchronously at launch, so the card never flashes before the choice is known (D5).
  const [notNow, setNotNow] = useState(() => notNowRemembered());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The step as the page's listener sees it, and whether a result was on screen when the app was last left (D4).
  const currentStep = useRef(step);
  useLayoutEffect(() => {
    currentStep.current = step;
  }, [step]);
  const leftWhileResultShowed = useRef(false);
  useEffect(() => {
    const opening = (): void => {
      if (document.visibilityState === "hidden") {
        leftWhileResultShowed.current = isResult(currentStep.current);
        return;
      }
      if (leftWhileResultShowed.current) setStep("idle");
      leftWhileResultShowed.current = false;
      setPermission(readPermission());
      // Once chosen, it stays for the session even when the device could not keep it (D5).
      setNotNow((chosen) => chosen || notNowRemembered());
    };
    document.addEventListener("visibilitychange", opening);
    return () => document.removeEventListener("visibilitychange", opening);
  }, []);

  // The screen's latest callbacks, so a turn-on under way tells the screen as it is when the outcome comes.
  const tellScreen = useRef({ onFailed, onRetried });
  useLayoutEffect(() => {
    tellScreen.current = { onFailed, onRetried };
  }, [onFailed, onRetried]);

  const turnOn = useCallback((): void => {
    // First, synchronously in the tap: iOS asks for permission only from a gesture (D3).
    const turning = turnNotificationsOn();
    setStep("enabling");
    // A new turn-on clears the screen's earlier failure (D8).
    tellScreen.current.onRetried();
    void turning.then((outcome) => {
      // A sign-out or a closed app ended the screen meanwhile: nothing left to show it on.
      if (!mounted.current) return;
      setStep(stepAfter(outcome));
      // Declined: the phone now blocks notifications, so once the Denied card goes, the menu item stays (D6, D7).
      if (outcome.kind === "declined") setPermission(readPermission());
      // Failed: the screen's one banner says so, offline or "later" (D8).
      if (outcome.kind === "failed") {
        tellScreen.current.onFailed(outcome.offline);
      }
    });
  }, []);

  // From the menu (D7): on a blocked phone, asking would do nothing, so the Denied card says where to turn them on;
  // otherwise as the card's button, the result shown in the card, and a remembered "Teď ne" stays.
  const fromMenu = useCallback((): void => {
    if (permission === "denied") {
      setStep("denied");
      return;
    }
    turnOn();
  }, [permission, turnOn]);

  const dismiss = useCallback((): void => {
    rememberNotNow();
    setNotNow(true);
    // A failure keeps the default card only to try again (D8); "Teď ne" hides it, so the step's own card goes too.
    setStep("idle");
  }, []);

  const supported = pushSupported(window);
  const offer = notificationOffer({
    supported,
    signedIn,
    underBalance,
    permission,
    notNow,
    step,
  });

  return { ...offer, turnOn, notNow: dismiss, fromMenu };
}

/**
 * The step a turn-on ends in (D3, D6): on → enabled; declined → the Denied card; undecided → back as it was, with no
 * banner; failed → the default card for the rest of this opening, its banner told to the screen (D8).
 */
function stepAfter(outcome: TurnOnOutcome): Step {
  switch (outcome.kind) {
    case "on":
      return "enabled";
    case "declined":
      return "denied";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

/** The phone's notification permission; "default" in a browser without `Notification`. */
function readPermission(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "default";
}

/** Whether the step is a result of this opening, which goes at the first return after it showed (D4). */
function isResult(step: Step): boolean {
  return step === "enabled" || step === "denied" || step === "failed";
}
