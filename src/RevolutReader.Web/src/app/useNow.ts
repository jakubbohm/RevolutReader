import { useEffect, useState } from "react";

/**
 * The time now, renewed every `everyMs` while the component is on the page, for text that counts from it ("Aktualizováno
 * před 2 min", c009 design.md D10). A plain interval, so the tests' clock drives it.
 */
export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const ticking = setInterval(() => {
      setNow(new Date());
    }, everyMs);

    return () => {
      clearInterval(ticking);
    };
  }, [everyMs]);

  return now;
}
