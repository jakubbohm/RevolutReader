// The page's intake of notifications' balances (c019 design.md D5, D6): from its own address and from the notifications
// the phone still shows, kept by c015's rule.
import { balanceInAddress, newest } from "./notificationBalance";
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
  if (!options.fromAddress && !options.fromList) return NOT_KEPT;

  // Without a registration or a subscription's secret nothing can verify, and there are no notifications to read (D5).
  const registration = await pushRegistration(browser);
  if (registration === null) return NOT_KEPT;
  const secret = await subscriptionSecret(registration);
  if (secret === null) return NOT_KEPT;

  const addresses = [
    ...(options.fromAddress ? [browser.location.href] : []),
    ...(options.fromList ? await listedAddresses(registration) : []),
  ];
  // Of every candidate whose code verifies and whose shape is right, only the one read last is kept (D6).
  const valid = (
    await Promise.all(
      addresses.map((address) => balanceInAddress(address, secret)),
    )
  ).filter((balance) => balance !== null);
  const latest = newest(valid);
  if (latest === null) return NOT_KEPT;
  return { kept: await keepNotificationBalance(latest) };
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
 * The `navigate` of every notification the phone still shows (`getNotifications()`, D5), those that have one as a
 * string; none when the browser's call fails. The service worker's own notifications have none (their address is in
 * `data`), and the tapped one is never listed.
 */
async function listedAddresses(
  registration: ServiceWorkerRegistration,
): Promise<string[]> {
  try {
    const shown: readonly unknown[] = await registration.getNotifications();
    return shown.flatMap((notification) => {
      const navigate =
        typeof notification === "object" && notification !== null
          ? (notification as { navigate?: unknown }).navigate
          : undefined;
      return typeof navigate === "string" ? [navigate] : [];
    });
  } catch {
    // The browser refused the list: no candidate from it this time (Error model).
    return [];
  }
}

/**
 * The secret of the push subscription the registration holds (`getKey("auth")`, D5), or null: no subscription, no
 * secret, or a browser call that fails.
 */
async function subscriptionSecret(
  registration: ServiceWorkerRegistration,
): Promise<ArrayBuffer | null> {
  try {
    const subscription = await currentSubscription(registration);
    return subscription?.getKey("auth") ?? null;
  } catch {
    // The browser refused: no balance from it this time (Error model).
    return null;
  }
}
