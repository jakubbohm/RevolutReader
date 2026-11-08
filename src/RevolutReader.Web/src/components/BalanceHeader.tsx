import { RefreshCw } from "lucide-react";
import { useId, type JSX } from "react";
import {
  czkApproxLabel,
  formatCzkApprox,
  formatEur,
  formatUpdated,
} from "../app/format";
import { Button } from "./Button";

export interface BalanceHeaderProps {
  /** The balance in euros. */
  amount: number;
  /** Koruna per euro, for the koruna value. */
  rate: number;
  /** When the server read the balance. */
  readAt: Date;
  /** The time now, for the freshness line. */
  now: Date;
  /** A read is under way. */
  refreshing: boolean;
  /** "Obnovit". */
  onRefresh: () => void;
}

/**
 * The account screen's header (design system BalanceHeader, c009 design.md D10), the first thing under the top bar:
 * "Na účtu máš" as the page's `h1` (`text-subhead`, muted), the amount in `text-amount-xl` in ink, never coloured, then
 * its koruna value (`text-subhead`, muted), spoken "přibližně … Kč"; both in tabular figures. Below them, the freshness
 * line (`text-footnote`, muted) in a polite live region that stays in place while its text changes, and the ghost
 * "Obnovit" with `refresh-cw`, which stands in for pull-to-refresh.
 */
export function BalanceHeader({
  amount,
  rate,
  readAt,
  now,
  onRefresh,
}: BalanceHeaderProps): JSX.Element {
  const labelId = useId();

  return (
    <section aria-labelledby={labelId} className="flex flex-col px-gutter">
      <h1 id={labelId} className="text-subhead text-ink-muted">
        Na účtu máš
      </h1>
      <p className="mt-1 text-amount-xl text-ink tabular-nums">
        {formatEur(amount)}
      </p>
      {/* An image role, so the line may carry its spoken form: ARIA allows no name on plain text. */}
      <p
        role="img"
        aria-label={czkApproxLabel(amount, rate)}
        className="text-subhead text-ink-muted tabular-nums"
      >
        {formatCzkApprox(amount, rate)}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-footnote text-ink-muted">
          {formatUpdated(readAt, now)}
        </p>
        <Button variant="ghost" icon={RefreshCw} onClick={onRefresh}>
          Obnovit
        </Button>
      </div>
    </section>
  );
}
