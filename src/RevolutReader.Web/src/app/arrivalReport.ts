// A push's arrival, reported to the server (c016 design.md D1-D3, D5). The service worker loads this module, through
// pushDisplay.ts, and has no `window`, so its only import is the schema's type, erased at build (c015 design.md D5).
import type { components } from "../api/schema";

/** The report's body, from the API description: `{ readAt }`. */
export type ArrivalReport =
  components["schemas"]["RevolutReaderApiPushArrivalReportRequest"];

/** The members of the service worker's scope a report needs (ServiceWorkerGlobalScope and the stand-in fit). */
export interface ReportingWorker {
  location: { origin: string };
  fetch(input: string, init: RequestInit): Promise<unknown>;
}

/** Where a phone reports a push's arrival, on the app's own origin (D3). */
const ARRIVALS = "/api/push/arrivals";

/**
 * Reports a push's arrival (D1-D3, D5): one POST of `{ readAt }` as JSON to `/api/push/arrivals` on the worker's own
 * origin, with same-origin credentials, no time limit and no keepalive. Ignores the answer; never rejects (offline, any
 * status); never sends again.
 */
export async function reportArrival(
  worker: ReportingWorker,
  readAt: string,
): Promise<void> {
  const report: ArrivalReport = { readAt };
  try {
    // Any answer is the end of it: a status is not looked at, so it never fails the report.
    await worker.fetch(new URL(ARRIVALS, worker.location.origin).href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      credentials: "same-origin",
    });
  } catch {
    // Not reported this time, and never sent again (D5): nothing about the report may stop the notification or the
    // balance, and a missing report shows in the server's records as one.
  }
}
