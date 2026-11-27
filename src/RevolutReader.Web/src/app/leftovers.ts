// What earlier work left on the phone (c019 design.md D11): the #113 spike's record in `localStorage`, removed at
// every start.

/** The spike's record: times, addresses and counts of its test notifications, no bank data. */
const SPIKE_RECORD = "tarjeta-papa.notification-test.record";

/** Removes the #113 spike's record from `localStorage`; a failure is ignored. */
export function removeSpikeLeftovers(storage?: Storage): void {
  try {
    // Inside the guard: reading `window.localStorage` itself throws where storage is blocked.
    (storage ?? localStorage).removeItem(SPIKE_RECORD);
  } catch {
    // Tidiness only: the record stays until a start that can remove it.
  }
}
