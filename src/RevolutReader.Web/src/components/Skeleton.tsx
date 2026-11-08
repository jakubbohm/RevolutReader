import type { JSX } from "react";

export interface SkeletonProps {
  /** What is loading; only the balance header's placeholder so far (C7b builds its list's). */
  variant: "balance";
}

/** One line of the real layout: its height, and the size of the block standing in for its text. */
interface Line {
  height: string;
  block: string;
}

/** Each variant's spoken label and lines. */
const variants: Record<
  SkeletonProps["variant"],
  { label: string; lines: Line[] }
> = {
  // BalanceHeader's lines at their own heights and gaps: the label, the amount, the koruna value, the freshness row.
  balance: {
    label: "Načítám zůstatek",
    lines: [
      { height: "h-5", block: "h-4 w-24" },
      { height: "mt-1 h-12", block: "h-10 w-50" },
      { height: "h-5", block: "h-4 w-21" },
      { height: "mt-2 h-12", block: "h-3.5 w-40" },
    ],
  },
};

/**
 * A placeholder while data loads on an awake server (design system Skeleton, c009 design.md D10): `color-surface-muted`
 * blocks with `radius-control`, laid out as the real content's lines, so nothing jumps when the data arrives, with a slow
 * 1.4 s opacity pulse that stands still under reduced motion. Announced as a status with its label ("Načítám
 * zůstatek"); the blocks are hidden from assistive technology.
 */
export function Skeleton({ variant }: SkeletonProps): JSX.Element {
  const { label, lines } = variants[variant];

  return (
    <div role="status" aria-label={label} className="flex flex-col px-gutter">
      <div aria-hidden="true" className="flex flex-col">
        {lines.map((line, index) => (
          <div key={index} className={`flex items-center ${line.height}`}>
            <span
              className={`block animate-skeleton-pulse rounded-control bg-surface-muted ${line.block}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
