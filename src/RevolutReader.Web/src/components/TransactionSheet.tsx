import * as Dialog from "@radix-ui/react-dialog";
import { Clock, X } from "lucide-react";
import { useRef, type JSX, type ReactNode } from "react";
import { formatAmount, formatDate, formatRate } from "../app/format";
import type { Transaction } from "../app/transactions";
import {
  korunaValue,
  rowLines,
  sheetSubtitle,
  statusWord,
} from "../app/transactionText";
import { amountColour } from "./amountColour";
import { TransactionIcon } from "./TransactionIcon";

export interface TransactionSheetProps {
  /** The transaction, as the API answers it. */
  tx: Transaction;
  /** Koruna per euro, for the koruna value and the rate line. */
  rate: number;
  /** The day of the koruna rate (`yyyy-MM-dd`), as the API answers it. */
  rateDate: string;
  /** Whether the sheet is open. */
  open: boolean;
  /** Escape, a tap on the scrim and "Zavřít" ask to close the sheet. */
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes back to when the sheet closes: the row that opened it. */
  returnFocusTo?: HTMLElement | null;
}

/**
 * One transaction's details as a bottom sheet (c010 design.md D4d, D14; design system TransactionSheet; the Screens
 * board "Account / Transaction sheet / Default"), a modal Radix `Dialog` over the scrim.
 *
 * Under the decorative handle: the icon disc, the title (the row's first line, `text-title`) over the kind's word, left
 * out when the title already is it, and the ghost close button "Zavřít" with `x`. Then the amount in `text-amount-lg`
 * over its koruna value (spoken "přibližně … Kč"), none for another currency. Then the details: "Stav", "Datum", the
 * bank's text in full under "Popis", line by line and only when there is any, and "Přepočet na koruny", the rate with
 * its date. Nothing to act on: the app is read-only.
 *
 * `color-surface`, the top corners `radius-sheet`, `shadow-sheet`, at most 88 % of the viewport, scrolling inside when
 * longer, the home-indicator inset below. It slides up over `duration-sheet` with `ease-sheet` while the scrim fades in,
 * and both leave over `duration-fast`; under reduced motion it fades instead of sliding. The focus moves to the sheet
 * itself on open, so no ring flashes and VoiceOver starts at the title; it stays inside while the sheet is open and goes
 * back to the row on close. Escape, a tap on the scrim and "Zavřít" close it.
 */
export function TransactionSheet({
  tx,
  rate,
  rateDate,
  open,
  onOpenChange,
  returnFocusTo,
}: TransactionSheetProps): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const subtitle = sheetSubtitle(tx);
  const koruna = korunaValue(tx, rate);
  const status = statusWord(tx);

  function focusTheSheet(event: Event): void {
    event.preventDefault();
    sheet.current?.focus({ preventScroll: true });
  }

  function focusTheRow(event: Event): void {
    if (returnFocusTo === null || returnFocusTo === undefined) return;

    event.preventDefault();
    returnFocusTo.focus();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-scrim-out data-[state=open]:animate-scrim-in" />
        <Dialog.Content
          ref={sheet}
          onOpenAutoFocus={focusTheSheet}
          onCloseAutoFocus={focusTheRow}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col overflow-y-auto rounded-t-sheet bg-surface px-gutter pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-gutter))] text-ink shadow-sheet outline-none data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-border-strong"
          />
          <div className="mt-3 flex items-start gap-3">
            <TransactionIcon tx={tx} />
            <div className="flex min-w-0 flex-1 flex-col pt-1">
              <Dialog.Title className="truncate text-title">
                {rowLines(tx).first}
              </Dialog.Title>
              {subtitle !== null ? (
                <Dialog.Description className="text-subhead text-ink-muted">
                  {subtitle}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Zavřít"
              className="-mt-0.5 -mr-2.5 inline-flex size-touch flex-none items-center justify-center rounded-full text-accent transition-[transform,background-color] duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] active:bg-accent-soft motion-reduce:active:scale-100"
            >
              <X size={22} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="mt-section flex flex-col tabular-nums">
            <p className={`text-amount-lg ${amountColour(tx)}`}>
              {formatAmount(tx.amount, tx.currency)}
            </p>
            {koruna !== null ? (
              // An image role, so the line may carry its spoken form: ARIA allows no name on plain text.
              <p
                role="img"
                aria-label={koruna.spoken}
                className="text-subhead text-ink-muted"
              >
                {koruna.shown}
              </p>
            ) : null}
          </div>
          <dl className="mt-section flex flex-col gap-4">
            <Detail term="Stav">
              {tx.pending ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-caption text-ink">
                  <Clock
                    size={14}
                    aria-hidden="true"
                    className="text-pending"
                  />
                  {status}
                </span>
              ) : (
                status
              )}
            </Detail>
            <Detail term="Datum">
              <span className="tabular-nums">{formatDate(tx.date)}</span>
            </Detail>
            {tx.details.length > 0 ? (
              <Detail term="Popis">
                <span className="flex flex-col wrap-anywhere">
                  {tx.details.map((line, index) => (
                    // The bank's lines have no identity of their own; a line's place is its key.
                    <span key={index}>{line}</span>
                  ))}
                </span>
              </Detail>
            ) : null}
            <Detail term="Přepočet na koruny">
              <span className="tabular-nums">{formatRate(rate, rateDate)}</span>
            </Detail>
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One of the sheet's details: its term (`text-footnote`, muted) over its value (`text-subhead`). */
function Detail({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-footnote text-ink-muted">{term}</dt>
      <dd className="text-subhead text-ink">{children}</dd>
    </div>
  );
}
