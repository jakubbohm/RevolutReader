import { useEffect, useState } from "react";

/**
 * Whether the page is on its way to another address (a sign-in at Microsoft, c007 slices 13 and 15), so the button that
 * started it shows it is loading and ignores further taps. When the visitor comes back with the browser's back button
 * and the browser restores the page from its back-forward cache (a `pageshow` whose `persisted` is true), the page is no
 * longer leaving, so the button is ready again; a `pageshow` of a normal load changes nothing.
 */
export function useLeaving(): readonly [
  leaving: boolean,
  setLeaving: (leaving: boolean) => void,
] {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    function restored(event: PageTransitionEvent): void {
      if (event.persisted) setLeaving(false);
    }

    window.addEventListener("pageshow", restored);

    return () => {
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  return [leaving, setLeaving] as const;
}
