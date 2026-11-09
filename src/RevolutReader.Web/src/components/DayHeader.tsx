import type { JSX } from "react";

export interface DayHeaderProps {
  /** The day, the API's calendar date (`yyyy-MM-dd`). */
  date: string;
  /** Now, for "Dnes" and "Včera". */
  now: Date;
  /** The day's totals, as `dayTotals` counts them. */
  totals: { incoming: number; outgoing: number };
}

/**
 * A day's heading in the list (c010 design.md D14, design system DayHeader): its label as an `h2` and the day's totals
 * with their spoken twins "Příchozí …" and "Odchozí …". A stub until c010 tasks.md task 41.1 is implemented; `void` keeps
 * the unused-parameter check quiet until then.
 */
export function DayHeader(props: DayHeaderProps): JSX.Element {
  void props;
  throw new Error("not implemented");
}
