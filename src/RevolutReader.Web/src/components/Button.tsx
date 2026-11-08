import { LoaderCircle } from "lucide-react";
import type { JSX, MouseEvent, ReactNode } from "react";

export interface ButtonProps {
  /** The label: a Czech verb. */
  children: ReactNode;
  onClick?: () => void;
  /** Full width, as the single main action at the bottom of a screen. */
  block?: boolean;
  /** A spinner beside the kept label and `aria-busy`; taps are ignored. */
  loading?: boolean;
  disabled?: boolean;
}

/**
 * The app's button (design system Button, c007 design.md D12), primary: the single main action on a screen, in
 * `color-accent` with `color-on-accent` text, 48 pt tall, `radius-control`. Pressed is `color-accent-pressed`, faded in
 * over `duration-fast`, and a 0.98 scale; under reduced motion the fill still fades, but nothing scales. Disabled is
 * `color-surface-muted` with `color-ink-muted` text; the focus ring is 2 px `color-focus`, offset 2 px.
 */
export function Button({
  children,
  onClick,
  block = false,
  loading = false,
  disabled = false,
}: ButtonProps): JSX.Element {
  function tap(event: MouseEvent<HTMLButtonElement>): void {
    if (loading) {
      event.preventDefault();
      return;
    }

    onClick?.();
  }

  return (
    <button
      type="button"
      onClick={tap}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-control bg-accent px-gutter text-body-strong text-on-accent transition-[transform,background-color] duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] active:bg-accent-pressed disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted aria-busy:cursor-progress motion-reduce:active:scale-100 ${block ? "w-full" : ""}`}
    >
      {loading ? (
        <LoaderCircle
          size={20}
          aria-hidden="true"
          className="animate-spin [animation-duration:var(--duration-spin)] motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
