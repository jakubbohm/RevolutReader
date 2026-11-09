import type { Transaction } from "./transactions";

// What a transaction's row says (c010 design.md D4): its two lines and the sentence a screen reader reads; pure.
// Stubs until c010 tasks.md task 44.1 is implemented; `void` keeps the unused-parameter check quiet until then.

/**
 * A row's two lines (D4b): the first the counterparty, else the kind's word; the second the bank's text, its lines
 * joined by " · ", else the kind's word, or `null` when the first line shows it already.
 */
export function rowLines(tx: Transaction): {
  first: string;
  second: string | null;
} {
  void tx;
  throw new Error("not implemented");
}

/**
 * The row's spoken label (D14): what the row shows, in order, joined by commas (the first line, the second, the amount,
 * the spoken koruna value at `rate`), without a time: `Pekárna U Lípy, Praha 2, −12,30 €, přibližně 299 Kč`.
 */
export function rowLabel(tx: Transaction, rate: number): string {
  void tx;
  void rate;
  throw new Error("not implemented");
}
