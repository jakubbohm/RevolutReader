import { expect, test } from "vitest";
import { HOUR, startTestClock, timePasses } from "../test/clock";
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

// ---- A failed report (group 19; design.md D5: never rejects, ignores the answer, never sends again) ----

/** A service worker whose `fetch` counts each request and gives `answer()` for it: a response, or a failed request. */
function workerAnswering(answer: () => Promise<unknown>): {
  worker: ReportingWorker;
  requestsSent: () => number;
} {
  let sent = 0;
  const worker: ReportingWorker = {
    location: { origin: WORKER_ORIGIN },
    fetch: () => {
      sent += 1;
      return answer();
    },
  };
  return { worker, requestsSent: () => sent };
}

/** The request fails, as the browser's `fetch` rejects when the device is offline. */
const offline = (): Promise<unknown> =>
  Promise.reject(new TypeError("Failed to fetch"));

/** A problem description with this status and title, as the API answers one (RFC 9457), made up. */
const problemAnswer = (status: number, title: string) => (): Promise<unknown> =>
  Promise.resolve(
    new Response(JSON.stringify({ title, status }), {
      status,
      headers: { "Content-Type": "application/problem+json" },
    }),
  );

test("A report resolves when the request fails (offline)", async () => {
  const { worker } = workerAnswering(offline);

  await expect(reportArrival(worker, READ_AT)).resolves.toBeUndefined();
});

test.each([
  { status: 401, title: "Unauthorized" },
  { status: 403, title: "Forbidden" },
  { status: 500, title: "Internal Server Error" },
])(
  "A report resolves when the server answers 401, 403 or 500: $status",
  async ({ status, title }) => {
    const { worker } = workerAnswering(problemAnswer(status, title));

    await expect(reportArrival(worker, READ_AT)).resolves.toBeUndefined();
  },
);

test.each([
  { label: "the request fails", answer: offline },
  {
    label: "the server answers 500",
    answer: problemAnswer(500, "Internal Server Error"),
  },
])("A failed report is never sent again: $label", async ({ answer }) => {
  startTestClock();
  const { worker, requestsSent } = workerAnswering(answer);

  await reportArrival(worker, READ_AT);
  // Long after: a later attempt on a timer would have gone by now.
  await timePasses(HOUR);

  expect(requestsSent(), "requests sent").toBe(1);
});
