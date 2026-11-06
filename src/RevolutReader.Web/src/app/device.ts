/** What the browser says about where the app runs (c003 design.md D8). */
export interface Device {
  userAgent: string;
  /** Opened from the Home Screen as an installed app, not in a browser tab. */
  standalone: boolean;
}

/** Reads the device facts: the user agent, and Safari's `navigator.standalone` or the standard display mode. */
export function readDevice(browser: Window): Device {
  const navigator: Navigator & { standalone?: boolean } = browser.navigator;
  return {
    userAgent: navigator.userAgent,
    standalone:
      navigator.standalone === true ||
      browser.matchMedia("(display-mode: standalone)").matches,
  };
}
