/**
 * The screen's refresh signal (c009 design.md D2, D3, D7 b): coming back to the screen (the page's `visibilitychange`
 * to `visible`) and coming back online (the window's `online`) ask for a refresh, every time, with no throttle; leaving
 * and going offline ask for nothing. Returns the stop function, for React's cleanup: each screen, and each test, starts
 * its own watch on the same page and window.
 */
export function watchRefreshTriggers(
  refresh: () => void,
  page: Document = document,
  browser: Window = window,
): () => void {
  function onVisibilityChange(): void {
    if (page.visibilityState === "visible") refresh();
  }

  function onOnline(): void {
    refresh();
  }

  page.addEventListener("visibilitychange", onVisibilityChange);
  browser.addEventListener("online", onOnline);

  return () => {
    page.removeEventListener("visibilitychange", onVisibilityChange);
    browser.removeEventListener("online", onOnline);
  };
}
