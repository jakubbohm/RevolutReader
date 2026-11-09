import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { JSX } from "react";
import { formatDayHeader, formatEur } from "../app/format";

export interface DayHeaderProps {
  /** The day, the API's calendar date (`yyyy-MM-dd`). */
  date: string;
  /** Now, for "Dnes" and "Včera". */
  now: Date;
  /** The day's totals, as `dayTotals` counts them. */
  totals: { incoming: number; outgoing: number };
  /** The heading's id, for the day's group to be named by it. */
  id?: string;
}

/**
 * A day's heading in the list (c010 design.md D14, design system DayHeader): its label as an `h2` and the day's totals
 * with their spoken twins "Příchozí …" and "Odchozí …". Opaque and sticky right under the top bar, so the next day's
 * heading pushes it away. The label ellipsizes when space runs out, the totals never do. Each total shows the arrow
 * its rows use and the amount, without a word or a sign: money received in `color-incoming`, money spent in
 * `color-ink-muted`, a total of zero left out. The visible totals are hidden from screen readers, which read the twins.
 */
export function DayHeader({
  date,
  now,
  totals,
  id,
}: DayHeaderProps): JSX.Element {
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top,0px)_+_var(--spacing-topbar))] z-10 flex items-baseline justify-between gap-3 bg-background px-gutter py-2">
      <h2 id={id} className="min-w-0 truncate text-section text-ink-muted">
        {formatDayHeader(date, now)}
      </h2>
      {totals.incoming > 0 || totals.outgoing > 0 ? (
        <p className="flex flex-none gap-3 text-footnote tabular-nums">
          {totals.incoming > 0 ? (
            <Total
              spoken="Příchozí"
              cents={totals.incoming}
              className="text-incoming"
              icon={<ArrowDownLeft size={14} aria-hidden="true" />}
            />
          ) : null}
          {totals.outgoing > 0 ? (
            <Total
              spoken="Odchozí"
              cents={totals.outgoing}
              className="text-ink-muted"
              icon={<ArrowUpRight size={14} aria-hidden="true" />}
            />
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** One of the day's totals: its visually hidden twin ("Příchozí 50,00 €"), and the arrow with the amount. */
function Total({
  spoken,
  cents,
  className,
  icon,
}: {
  spoken: string;
  cents: number;
  className: string;
  icon: JSX.Element;
}): JSX.Element {
  const amount = formatEur(cents / 100);

  return (
    <span>
      <span className="sr-only">{`${spoken} ${amount}`}</span>
      <span
        aria-hidden="true"
        className={`inline-flex items-center gap-1 ${className}`}
      >
        {icon}
        <span>{amount}</span>
      </span>
    </span>
  );
}
