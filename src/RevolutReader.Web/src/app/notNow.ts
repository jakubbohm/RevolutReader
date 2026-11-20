/**
 * The remembered "Teď ne" (c012 design.md D5): the device's choice, in `localStorage`, read synchronously when the
 * screen renders.
 */

export const NOT_NOW_KEY = "tarjeta-papa.notifications.not-now";

/** Whether "Teď ne" is remembered on this device; a failing storage reads as not. */
export function notNowRemembered(storage?: Storage): boolean {
  void storage;
  throw new Error("Not implemented");
}

/** Remembers "Teď ne"; a failure is ignored. */
export function rememberNotNow(storage?: Storage): void {
  void storage;
  throw new Error("Not implemented");
}
