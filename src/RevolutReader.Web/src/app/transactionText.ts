import { czkApproxLabel, formatAmount, formatCzkApprox } from "./format";
import type { Transaction, TransactionKind } from "./transactions";

// What a transaction's row says (c010 design.md D4): its two lines, its koruna value and the sentence a screen reader
// reads; pure.

/** Each known kind's word (D4b); `other` has none of its own and is named by its direction instead. */
const KIND_WORDS: Record<Exclude<TransactionKind, "other">, string> = {
  card: "Platba kartou",
  topup: "Dobití účtu",
  transfer: "Převod",
  atm: "Výběr z bankomatu",
  exchange: "Směna měny",
  refund: "Vrácení peněz",
};

/**
 * The kind's word (D4b): the known kinds' own, else "Příchozí platba" for money received and "Odchozí platba" for money
 * spent, by the sign of `amount`.
 */
export function kindWord(kind: TransactionKind, amount: number): string {
  if (kind !== "other") return KIND_WORDS[kind];

  return amount > 0 ? "Příchozí platba" : "Odchozí platba";
}

/**
 * A row's two lines (D4b): the first the counterparty, else the kind's word; the second the bank's text, its lines
 * joined by " · ", else the kind's word, or `null` when the first line already is that word.
 */
export function rowLines(tx: Transaction): {
  first: string;
  second: string | null;
} {
  const word = kindWord(tx.kind, tx.amount);
  const first = tx.counterparty ?? word;

  if (tx.details.length > 0) return { first, second: tx.details.join(" · ") };

  return { first, second: first === word ? null : word };
}

/**
 * The sheet's subtitle (D4d): the kind's word, or `null` when the sheet's title, the row's first line, already is that
 * word, so that the sheet never says it twice.
 */
export function sheetSubtitle(tx: Transaction): string | null {
  const word = kindWord(tx.kind, tx.amount);

  return rowLines(tx).first === word ? null : word;
}

/**
 * The sheet's "Stav" (D4c, D4d): "Čeká na zpracování" while pending, a refund included, since it is not on the account
 * yet; once settled "Vráceno na účet" for a refund, else "Zaúčtováno".
 */
export function statusWord(
  tx: Transaction,
): "Zaúčtováno" | "Vráceno na účet" | "Čeká na zpracování" {
  if (tx.pending) return "Čeká na zpracování";

  return tx.kind === "refund" ? "Vráceno na účet" : "Zaúčtováno";
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
