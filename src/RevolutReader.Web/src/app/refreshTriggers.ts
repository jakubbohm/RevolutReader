/**
 * The screen's refresh signal (c009 design.md D3, D7 b): coming back to the screen (the page's `visibilitychange` to
 * `visible`) asks for a refresh, every time, with no throttle; leaving asks for nothing. Returns the stop function, for
 * React's cleanup: each screen, and each test, starts its own watch on the same page.
 */
export function watchRefreshTriggers(
  refresh: () => void,
  page: Document = document,
): () => void {
  function onVisibilityChange(): void {
    if (page.visibilityState === "visible") refresh();
  }

  page.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    page.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
