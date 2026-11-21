import { expect, test } from "vitest";
import { reportArrival, type ReportingWorker } from "./arrivalReport";

// A push's arrival, reported to the server (c016 design.md D1-D3, D5). Every value here is made up.

/** The service worker's own origin: made up, and not the page's (jsdom's), so a report sent elsewhere shows. */
const WORKER_ORIGIN = "https://reader.example";

/** A read time as the API writes one into a push, with a fraction of a second (design.md D2). */
const READ_AT = "2026-11-21T09:14:03.5123456+00:00";

/** A request the service worker sent through its `fetch`, as it handed it over. */
interface SentRequest {
  input: string;
  init: RequestInit;
}

/** A service worker whose `fetch` records each request and answers 204, as the server does when it records an arrival. */
function recordingWorker(): { worker: ReportingWorker; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const worker: ReportingWorker = {
    location: { origin: WORKER_ORIGIN },
    fetch: (input, init) => {
      sent.push({ input, init });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  };
  return { worker, sent };
}

test("A report is one POST to /api/push/arrivals on the worker's own origin, as JSON with only readAt, with same-origin credentials", async () => {
  const { worker, sent } = recordingWorker();

  await reportArrival(worker, READ_AT);

  expect(sent, "requests sent").toHaveLength(1);
  const [{ input, init }] = sent;
  const contentType = new Headers(init.headers).get("Content-Type") ?? "";
  // A path is resolved against the worker's own location, as the service worker's fetch resolves it.
  expect(new URL(input, WORKER_ORIGIN).href, "the address").toBe(
    `${WORKER_ORIGIN}/api/push/arrivals`,
  );
  expect(init.method?.toUpperCase(), "the method").toBe("POST");
  expect(contentType.split(";")[0].trim(), "the content type").toBe(
    "application/json",
  );
  expect(
    JSON.parse(await new Response(init.body).text()),
    "the body: only the read time, exactly as given",
  ).toEqual({ readAt: READ_AT });
  expect(init.credentials, "the credentials").toBe("same-origin");
});
