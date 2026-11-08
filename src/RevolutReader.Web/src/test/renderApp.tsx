import { render, type RenderResult } from "@testing-library/react";
import { App } from "../App";
import type { Device } from "../app/device";
import {
  answerWith,
  navigations,
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
  /** Where the app navigated, in order, as `/path?query` on its own origin. */
  navigations(): string[];
  /** Requests, answers, failures and navigations, in the order they happened (./server.ts). */
  timeline(): string[];
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
 */
export function renderApp(
  opened: Opened,
  server: ServerAnswers = {},
): RenderedApp {
  answerWith(server);

  return {
    ...render(<App device={devices[opened]} />),
    requests,
    navigations,
    timeline,
  };
}
