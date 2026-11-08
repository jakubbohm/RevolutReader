import { screen, within } from "@testing-library/react";

/**
 * The screen's banners by their tone, as assistive technology hears them (design system Banner, c009 design.md D10): an
 * error is announced as an alert, a warning as a status. Each finds the one that holds `title` and throws when there is
 * none, so a scenario reads "the error … with …" in its own words. Synchronous: on the test clock (./clock.ts), call
 * them after `timePasses`.
 */

/** The error banner titled `title`. */
export function errorBanner(title: string): HTMLElement {
  return bannerTitled("alert", title, "error");
}

/** The warning banner titled `title`. */
export function warningBanner(title: string): HTMLElement {
  return bannerTitled("status", title, "warning");
}

function bannerTitled(
  role: "alert" | "status",
  title: string,
  tone: string,
): HTMLElement {
  const banner = screen
    .queryAllByRole(role)
    .find((element) => within(element).queryByText(title) !== null);
  if (banner === undefined)
    throw new Error(
      `No ${tone} titled "${title}" (an element with role "${role}" holding that text) is on the screen.`,
    );
  return banner;
}
