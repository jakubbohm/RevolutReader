/**
 * The screen's refresh signal (c009 design.md D3, D7 b): coming back to the screen and back online ask for a refresh.
 * Returns the stop function, for React's cleanup. A stub until c009 tasks.md group 23 is implemented; `void` keeps the
 * unused-parameter check quiet until then.
 */
export function watchRefreshTriggers(
  refresh: () => void,
  page: Document = document,
  browser: Window = window,
): () => void {
  void refresh;
  void page;
  void browser;
  throw new Error("not implemented");
}
