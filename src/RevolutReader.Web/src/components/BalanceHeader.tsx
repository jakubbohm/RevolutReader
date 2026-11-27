import { RefreshCw } from "lucide-react";
import { useId, type JSX } from "react";
import {
  czkApproxLabel,
  formatCzkApprox,
  formatEur,
  formatUpdated,
} from "../app/format";
import type { BalanceState } from "../app/screenState";
import { Button } from "./Button";
import { useWaitClock } from "./waitClock";

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
  /** Whether the balance is live (c019 design.md D8, D9); `live` when not given. */
  state?: BalanceState;
}

/** The amount's class for each state (c019 design.md D9; the utilities in `theme.css`). */
const AMOUNT_CLASS: Record<BalanceState, string> = {
  live: "amount-live",
  waiting: "amount-waiting",
  stale: "amount-stale",
};

/**
 * The account screen's header (design system BalanceHeader, c009 design.md D10), the first thing under the top bar:
 * "Na účtu máš" as the page's `h1` (`text-subhead`, muted), the amount in `text-amount-xl`, ink or grey by its state but never coloured, then
 * its koruna value (`text-subhead`, muted), spoken "přibližně … Kč"; both in tabular figures. Below them, the freshness
 * line (`text-footnote`, muted) in a polite live region that stays in place while its text changes, and the ghost
 * "Obnovit" with `refresh-cw`, which stands in for pull-to-refresh.
 *
 * While a read is under way, the line reads "Obnovuji…" in the same live region, and "Obnovit" keeps its label as the
 * busy button: a spinner in place of its icon, `aria-busy`, taps ignored. The amount stays shown, never blanked.
 *
 * Whether the balance is live (c019 design.md D8, D9) is `state`, `live` when not given: the amount's colour comes from
 * its class, `amount-live` (ink), `amount-waiting` (grey with the shine) or `amount-stale` (grey), and the section
 * carries it as `data-balance`. It is never text and never `aria-busy`; the koruna line and the freshness line are the
 * same in every state. While `waiting`, the shine runs on the one wait clock (`useWaitClock`), its phase set when
 * waiting begins, in step with the waking-up bar. The amount's box is as wide as its digits (`self-start`, at the same
 * start as the lines around it), so the shine's 40 % band and its path are the digits' own (D9), not the header's.
 */
export function BalanceHeader({
  amount,
  rate,
  readAt,
  now,
  refreshing,
  onRefresh,
  state = "live",
}: BalanceHeaderProps): JSX.Element {
  const labelId = useId();
  const amountRef = useWaitClock<HTMLParagraphElement>(state === "waiting");

  return (
    <section
      aria-labelledby={labelId}
      data-balance={state}
      className="flex flex-col px-gutter"
    >
      <h1 id={labelId} className="text-subhead text-ink-muted">
        Na účtu máš
      </h1>
      <p
        ref={amountRef}
        className={`mt-1 self-start text-amount-xl tabular-nums ${AMOUNT_CLASS[state]}`}
      >
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
          {refreshing ? "Obnovuji…" : formatUpdated(readAt, now)}
        </p>
        <Button
          variant="ghost"
          icon={RefreshCw}
          loading={refreshing}
          onClick={onRefresh}
        >
          Obnovit
        </Button>
      </div>
    </section>
  );
}
