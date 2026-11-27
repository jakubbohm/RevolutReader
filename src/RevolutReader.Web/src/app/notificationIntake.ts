// The page's intake of notifications' balances (c019 design.md D5, D6): from its own address and from the notifications
// the phone still shows, kept by c015's rule.
import { balanceInAddress } from "./notificationBalance";
import { currentSubscription } from "./push";
import { keepNotificationBalance } from "./storedBalance";
import { pushRegistration } from "./subscriptionUpkeep";

/** What one intake came to. */
export interface IntakeOutcome {
  /** A balance was kept in place of the one before. */
  kept: boolean;
}

/** The launch's wait for the intake (D6): the kept balance shows after the intake, or after this long at most. */
export const LAUNCH_INTAKE_LIMIT_MS = 300;

const NOT_KEPT: IntakeOutcome = { kept: false };

/**
 * Takes in the newest valid balance of the page's own address (`fromAddress`) and of every listed notification's
 * `navigate` (`fromList`), kept by `keepNotificationBalance`; removes a balance fragment from the page's address. Never
 * rejects: every browser call that fails means no balance from it.
 */
export async function takeInNotificationBalances(options: {
  fromAddress: boolean;
  fromList: boolean;
  browser?: Window;
}): Promise<IntakeOutcome> {
  const browser = options.browser ?? window;
  if (!options.fromAddress) return NOT_KEPT;

  const address = browser.location.href;
  const secret = await subscriptionSecret(browser);
  const balance = await balanceInAddress(address, secret);
  if (balance === null) return NOT_KEPT;

  return { kept: await keepNotificationBalance(balance) };
}

/** Runs `onChange` on every `hashchange` (D5); returns the stop function. */
export function watchAddress(
  onChange: () => void,
  browser: Window = window,
): () => void {
  const listener = (): void => {
    onChange();
  };
  browser.addEventListener("hashchange", listener);
  return () => {
    browser.removeEventListener("hashchange", listener);
  };
}

/**
 * The secret of the push subscription the phone holds (`getKey("auth")`, D5), or null: no registration, no subscription,
 * no secret, or a browser call that fails.
 */
async function subscriptionSecret(
  browser: Window,
): Promise<ArrayBuffer | null> {
  try {
    const registration = await pushRegistration(browser);
    if (registration === null) return null;
    const subscription = await currentSubscription(registration);
    return subscription?.getKey("auth") ?? null;
  } catch {
    // The browser refused: no balance from it this time (Error model).
    return null;
  }
}
