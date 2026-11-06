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

/**
 * Whether the app shows only the install hint: on an iPhone, in a browser tab rather than the Home Screen app
 * (c003 design.md D8). Every iPhone browser counts, not only Safari: none of them gets push or the Home Screen app's
 * sign-in. An iPad reports itself as a Mac, so it gets the app, as do Android phones and computers.
 */
export function needsInstallHint(device: Device): boolean {
  return device.userAgent.includes("iPhone") && !device.standalone;
}
