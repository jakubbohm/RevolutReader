/**
 * The remembered "Teď ne" (c012 design.md D5): the device's choice, in `localStorage`, read synchronously when the
 * screen renders.
 */

export const NOT_NOW_KEY = "tarjeta-papa.notifications.not-now";

const REMEMBERED = "1";

/** Whether "Teď ne" is remembered on this device; a failing storage reads as not. */
export function notNowRemembered(storage?: Storage): boolean {
  try {
    // Inside the guard: reading `window.localStorage` itself throws where storage is blocked.
    return (storage ?? localStorage).getItem(NOT_NOW_KEY) === REMEMBERED;
  } catch {
    return false;
  }
}

/** Remembers "Teď ne"; a failure is ignored. */
export function rememberNotNow(storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(NOT_NOW_KEY, REMEMBERED);
  } catch {
    // Not kept on the device: the card still hides for this session (D5).
  }
}
