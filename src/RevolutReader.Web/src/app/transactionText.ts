import { czkApproxLabel, formatAmount, formatCzkApprox } from "./format";
import type { Transaction, TransactionKind } from "./transactions";

// What a transaction's row says (c010 design.md D4): its two lines, its koruna value and the sentence a screen reader
// reads; pure.

/**
 * The kinds' words a row shows so far (D4b): the first line of a transaction without a counterparty. The other kinds'
 * words come with their own slices (c010 tasks.md groups 46 and 50); until then such a line stays empty.
 */
const KIND_WORDS: Partial<Record<TransactionKind, string>> = {
  topup: "Dobití účtu",
};

function kindWord(kind: TransactionKind): string {
  return KIND_WORDS[kind] ?? "";
}

/**
 * A row's two lines (D4b): the first the counterparty, else the kind's word; the second the bank's text, its lines
 * joined by " · ", or `null` without any.
 */
export function rowLines(tx: Transaction): {
  first: string;
  second: string | null;
} {
  return {
    first: tx.counterparty ?? kindWord(tx.kind),
    second: tx.details.length > 0 ? tx.details.join(" · ") : null,
  };
}

/**
 * The koruna value under a row's amount at `rate` (D6), as shown (`≈ 299 Kč`) and as spoken (`přibližně 299 Kč`); `null`
 * for an amount in another currency than the euro, which has none (D4).
 */
export function korunaValue(
  tx: Transaction,
  rate: number,
): { shown: string; spoken: string } | null {
  if (tx.currency !== "EUR") return null;

  return {
    shown: formatCzkApprox(tx.amount, rate),
    spoken: czkApproxLabel(tx.amount, rate),
  };
}

/**
 * The row's spoken label (D14): what the row shows, in order, joined by commas (the first line, the second, the amount,
 * the spoken koruna value at `rate`), without a time: `Pekárna U Lípy, Praha 2, −12,30 €, přibližně 299 Kč`.
 */
export function rowLabel(tx: Transaction, rate: number): string {
  const { first, second } = rowLines(tx);

  return [
    first,
    second,
    formatAmount(tx.amount, tx.currency),
    korunaValue(tx, rate)?.spoken,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(", ");
}
