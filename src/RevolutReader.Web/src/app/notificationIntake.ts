// The page's intake of notifications' balances (c019 design.md D5, D6): from its own address and from the notifications
// the phone still shows, kept by c015's rule.
import {
  balanceInAddress,
  carriesBalance,
  newest,
} from "./notificationBalance";
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
 * `navigate` (`fromList`), kept by `keepNotificationBalance`: the address's first, then the address cleaned of its
 * balance fragment, then the list's. `kept` is whether either replaced the kept balance. Never rejects: every browser
 * call that fails means no balance from it, and a list left hanging holds back only the list's.
 */
export async function takeInNotificationBalances(options: {
  fromAddress: boolean;
  fromList: boolean;
  browser?: Window;
}): Promise<IntakeOutcome> {
  const browser = options.browser ?? window;
  if (!options.fromAddress && !options.fromList) return NOT_KEPT;
  const address = options.fromAddress ? browser.location.href : null;

  // Without a registration or a subscription's secret nothing can verify, and there are no notifications to read (D5).
  const push = await pushOf(browser);

  // The address first, kept and cleaned on its own, so a list the browser leaves hanging never holds it back (D5:
  // every browser call may fail or hang). The list's newest then goes through the same not-earlier rule (c015 D3), so
  // what stays kept is the newest of all, whichever was kept first.
  const fromAddress =
    address === null ? false : await takeInAddress(address, push, browser);
  const fromList =
    options.fromList && push !== null
      ? await keepNewest(await listedAddresses(push.registration), push.secret)
      : false;
  return { kept: fromAddress || fromList };
}

/** The registration push needs and its subscription's secret; null without either (D5). Never rejects. */
async function pushOf(browser: Window): Promise<{
  registration: ServiceWorkerRegistration;
  secret: ArrayBuffer;
} | null> {
  const registration = await pushRegistration(browser);
  if (registration === null) return null;
  const secret = await subscriptionSecret(registration);
  return secret === null ? null : { registration, secret };
}

/**
 * Keeps the balance in the page's `address` when it is valid, then cleans the address (D6), also when there is no
 * push to verify it with; whether it was kept.
 */
async function takeInAddress(
  address: string,
  push: { secret: ArrayBuffer } | null,
  browser: Window,
): Promise<boolean> {
  try {
    return push === null ? false : await keepNewest([address], push.secret);
  } finally {
    cleanAddress(browser, address);
  }
}

/** The text after the address's first `#`, or null when it has none. */
function fragmentOf(address: string): string | null {
  const hash = address.indexOf("#");
  return hash === -1 ? null : address.slice(hash + 1);
}

/**
 * Of these addresses, the balance whose code verifies under `secret` and whose shape is right, the one read last (D6),
 * kept by `keepNotificationBalance`; whether it replaced the kept one.
 */
async function keepNewest(
  addresses: readonly string[],
  secret: ArrayBuffer,
): Promise<boolean> {
  const valid = (
    await Promise.all(
      addresses.map((address) => balanceInAddress(address, secret)),
    )
  ).filter((balance) => balance !== null);
  const latest = newest(valid);
  return latest === null ? false : keepNotificationBalance(latest);
}

/**
 * The page's address without the balance fragment this intake read (`read`), valid or not (D6), whatever the intake
 * came to and on a browser without push too: the same path and query, by `history.replaceState`, which fires no
 * `hashchange` and leaves no entry, so a bookmark, a share or the back button never carries it. Only while the address
 * still carries that same fragment: one that came after it is left for the intake its `hashchange` started, since
 * intakes run side by side. Another fragment, or none, is left as it is.
 */
function cleanAddress(browser: Window, read: string): void {
  if (!carriesBalance(read)) return;
  const { href, pathname, search } = browser.location;
  if (fragmentOf(href) !== fragmentOf(read)) return;
  try {
    browser.history.replaceState(browser.history.state, "", pathname + search);
  } catch {
    // The browser refused: the address keeps the fragment, and the next intake reads it again (Error model).
  }
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
