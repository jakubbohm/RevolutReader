import { render, type RenderResult } from "@testing-library/react";
import { App } from "../App";
import type { Device } from "../app/device";
import {
  answerWith,
  closeApp,
  navigations,
  openPageAt,
  pageAddress,
  requests,
  timeline,
  type ServerAnswers,
} from "./server";

/** Where the app is opened, in the scenarios' words (c003 design.md D8). */
export type Opened =
  "iPhone Safari" | "iPhone Home Screen" | "computer browser";

/** The rendered app, and what it did with the server and the address bar (./server.ts). */
export interface RenderedApp extends RenderResult {
  /** The requests the app sent, in order, as `METHOD /path?query`. */
  requests(): string[];
  /** How many times the app sent this request (`METHOD /path?query`), over every launch in the test. */
  timesSent(request: string): number;
  /** Where the app navigated, in order, as `/path?query` on its own origin. */
  navigations(): string[];
  /** Requests, answers, failures, aborts and navigations, in the order they happened (./server.ts). */
  timeline(): string[];
  /** The app's address now, as path, query and fragment on its own origin (c019: `pageAddress` of ./server.ts). */
  address(): string;
  /**
   * Closes the app and opens it again where it was first opened (c009 design.md D8): unmounted, then a new launch,
   * from the app's icon, so at its start page `/` whatever address the first launch had (c019). The server keeps its
   * answers and goes on with them in order, the phone keeps what it stored (the balance, the remembered "Teď ne"), and
   * the push stand-ins (./push.ts) stay as they are, the notifications they show too; answers to the closed app's
   * requests never arrive. The network and the screen stay as they are, so `goOffline()` first opens it offline.
   * Returns the new launch. On the test clock, `timePasses(0)` lets it read the phone's storage.
   */
  reopen(): RenderedApp;
}

/** How the app is launched (c019). */
export interface Launch {
  /**
   * The address it opens at, on its own origin, its fragment included: a notification's address for a launch by a tap
   * on it (c019 design.md D5); by default the start page `/`, as from the app's icon.
   */
  address?: string;
}

/** Safari on an iPhone, as it reports itself. */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

/** Chrome on a Windows computer, as it reports itself. */
const COMPUTER_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/** The facts the browser gives in each place: the same iPhone, once in a Safari tab and once as the Home Screen app. */
const devices: Record<Opened, Device> = {
  "iPhone Safari": { userAgent: IPHONE_SAFARI, standalone: false },
  "iPhone Home Screen": { userAgent: IPHONE_SAFARI, standalone: true },
  "computer browser": { userAgent: COMPUTER_CHROME, standalone: false },
};

/**
 * Renders the whole app as it starts where it is opened, so a scenario runs through the real install-hint rule, with
 * the server answering as `server` says (c007 design.md D3). Without an answer to who is signed in, the question stays
 * open, as while the server wakes up.
 *
 * On the test clock (`./clock.ts`), rendering moves no time: the app has sent its first requests, and their answers
 * arrive on `timePasses(0)` (or after their `after`).
 *
 * The app opens at `launchedAs.address` when given (c019), else at its start page `/`.
 */
export function renderApp(
  opened: Opened,
  server: ServerAnswers = {},
  launchedAs: Launch = {},
): RenderedApp {
  answerWith(server);

  return launch(opened, launchedAs.address ?? START_PAGE);
}

/** The app's start page, where an opening from its icon lands (the manifest's `start_url`). */
const START_PAGE = "/";

function launch(opened: Opened, address: string): RenderedApp {
  openPageAt(address);
  const rendered = render(<App device={devices[opened]} />);

  return {
    ...rendered,
    requests,
    timesSent: (request) =>
      requests().filter((sent) => sent === request).length,
    navigations,
    timeline,
    address: pageAddress,
    reopen: () => {
      rendered.unmount();
      closeApp();
      return launch(opened, START_PAGE);
    },
  };
}
