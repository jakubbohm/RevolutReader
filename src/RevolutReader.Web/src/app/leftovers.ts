// What earlier work left on the phone (c019 design.md D11): the #113 spike's record in `localStorage`, removed at
// every start.

/** Removes the #113 spike's record from `localStorage`; a failure is ignored. */
export function removeSpikeLeftovers(storage?: Storage): void {
  void storage;
  throw new Error("Not implemented: removeSpikeLeftovers (c019 design.md D11)");
}
