/** The service worker registration's update check (c003 design.md D9). */
export interface UpdatableRegistration {
  update(): Promise<unknown>;
}

/** Whether the app is on the screen, as the page reports it. */
export interface Page {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Whether the phone is online. */
export interface Network {
  onLine: boolean;
}

/**
 * Asks for an update check whenever the app comes back to the screen while the phone is online; a failed check is
 * ignored, and the next return tries again (c003 design.md D9). Returns a function that stops watching.
 */
export function watchForUpdates(
  registration: UpdatableRegistration,
  page: Page,
  network: Network,
): () => void {
  void registration;
  void page;
  void network;
  throw new Error("Not implemented: watchForUpdates");
}
