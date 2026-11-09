import type { JSX } from "react";

export interface SkeletonProps {
  /** What is loading; only the transaction list's placeholder here (C7a builds the balance header's). */
  variant: "list";
  /** How many placeholder rows the list shows (design system Skeleton: 4 by default). */
  rows?: number;
}

/** A placeholder block standing in for a line of text or an icon. */
const BLOCK = "block animate-skeleton-pulse bg-surface-muted";

/**
 * The widths of each placeholder row's two lines, so the rows read as different texts: line 1 shorter row by row, line 2
 * longer (design system Skeleton). Literal class names, so Tailwind finds them; more rows repeat them.
 */
const ROW_LINES: readonly { first: string; second: string }[] = [
  { first: "w-3/5", second: "w-2/5" },
  { first: "w-[53%]", second: "w-[45%]" },
  { first: "w-[46%]", second: "w-1/2" },
  { first: "w-[39%]", second: "w-[55%]" },
];

/**
 * A placeholder while data loads on an awake server (design system Skeleton, c010 design.md D7, D14):
 * `color-surface-muted` blocks with `radius-control` (discs `radius-full`), laid out as the real content's lines, so
 * nothing jumps when the data arrives, with a slow 1.4 s opacity pulse that stands still under reduced motion. Announced
 * as a status with its label ("Načítám pohyby"); the blocks are hidden from assistive technology.
 */
export function Skeleton({ variant, rows = 4 }: SkeletonProps): JSX.Element {
  switch (variant) {
    case "list":
      return <ListSkeleton rows={rows} />;
  }
}

/**
 * The transaction list's placeholder: one day, as `DayGroup` lays it out, its header's label over a card of `rows`
 * rows, each as `TransactionRow` lays it out (the icon disc, the two lines, the amount over its koruna line, at least
 * 64 pt, hairlines inset to the text).
 */
function ListSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div role="status" aria-label="Načítám pohyby" className="flex flex-col">
      <div aria-hidden="true" className="flex flex-col">
        <div className="flex h-8.5 items-center px-gutter">
          <span className={`${BLOCK} h-3.5 w-14 rounded-control`} />
        </div>
        <div className="mx-gutter flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {Array.from({ length: rows }, (_, index) => {
            const lines = ROW_LINES[index % ROW_LINES.length];

            return (
              <div key={index} className="flex min-h-16 items-stretch">
                <div className="flex items-center pr-3 pl-gutter">
                  <span className={`${BLOCK} size-10 rounded-full`} />
                </div>
                <div
                  className={`flex min-w-0 flex-1 items-center gap-3 py-row pr-gutter ${index === 0 ? "" : "border-t border-border"}`}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-5.5 items-center">
                      <span
                        className={`${BLOCK} h-3.5 rounded-control ${lines.first}`}
                      />
                    </div>
                    <div className="flex h-5 items-center">
                      <span
                        className={`${BLOCK} h-3 rounded-control ${lines.second}`}
                      />
                    </div>
                  </div>
                  <div className="flex flex-none flex-col items-end">
                    <div className="flex h-5.5 items-center">
                      <span className={`${BLOCK} h-3.5 w-16 rounded-control`} />
                    </div>
                    <div className="flex h-4.5 items-center">
                      <span className={`${BLOCK} h-3 w-11 rounded-control`} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
