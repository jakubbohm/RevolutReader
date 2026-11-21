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

/**
 * Reports a push's arrival (D1-D3, D5): one POST of `{ readAt }` as JSON to `/api/push/arrivals` on the worker's own
 * origin, with same-origin credentials, no time limit and no keepalive. Ignores the answer; never rejects (offline, any
 * status); never sends again.
 */
export function reportArrival(
  _worker: ReportingWorker,
  _readAt: string,
): Promise<void> {
  throw new Error("Not implemented yet: reportArrival (c016 tasks.md 11.1).");
}
