/**
 * The page's service worker that never becomes ready (c012 design.md D8): `navigator.serviceWorker.ready` never
 * settles, as when the service worker failed to install or was never registered. Built on the push stand-ins
 * (./push.ts), which make it ready at once; this replaces only their `ready`, so it goes with them after the test.
 *
 * Call `serviceWorkerNeverReady()` after `installPushStandIns`.
 */
export function serviceWorkerNeverReady(): void {
  const container = (navigator as { serviceWorker?: object }).serviceWorker;
  if (container === undefined)
    throw new Error(
      "serviceWorkerNeverReady needs the push stand-ins: call installPushStandIns() first.",
    );
  Object.defineProperty(container, "ready", {
    configurable: true,
    value: new Promise<ServiceWorkerRegistration>(() => {}),
  });
}
