import type { JSX } from "react";

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
 * The account screen's header (design system BalanceHeader, c009 design.md D10). A stub until c009 tasks.md group 17 is
 * implemented; `void` keeps the unused-parameter check quiet until then.
 */
export function BalanceHeader(props: BalanceHeaderProps): JSX.Element {
  void props;
  throw new Error("not implemented");
}
