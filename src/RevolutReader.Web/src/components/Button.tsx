import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { JSX, MouseEvent, ReactNode } from "react";

export interface ButtonProps {
  /** The label: a Czech verb. */
  children: ReactNode;
  onClick?: () => void;
  /** `primary` (the default): the single main action on a screen; `ghost`: a low-emphasis action, such as "Obnovit". */
  variant?: "primary" | "ghost";
  /** A Lucide icon before the label, 20 px; the spinner takes its place while loading. */
  icon?: LucideIcon;
  /** Full width, as the single main action at the bottom of a screen. */
  block?: boolean;
  /** A spinner beside the kept label and `aria-busy`; taps are ignored. */
  loading?: boolean;
  disabled?: boolean;
}

/** What every variant shares: 48 pt tall, `radius-control`, the press scale, the focus ring and the disabled look. */
const BASE =
  "inline-flex h-12 items-center justify-center gap-2 rounded-control px-gutter text-body-strong transition-[transform,background-color] duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted aria-busy:cursor-progress motion-reduce:active:scale-100";

/** Each variant's fill and text, at rest and pressed. */
const VARIANTS = {
  primary: "bg-accent text-on-accent active:bg-accent-pressed",
  ghost: "bg-transparent text-accent active:bg-accent-soft",
} as const;

/**
 * The app's button (design system Button, c007 design.md D12, c009 D10), 48 pt tall, `radius-control`. Primary: the
 * single main action on a screen, in `color-accent` with `color-on-accent` text, pressed `color-accent-pressed`. Ghost:
 * transparent with `color-accent` text, pressed `color-accent-soft`. Pressed fades in over `duration-fast` with a 0.98
 * scale; under reduced motion the fill still fades, but nothing scales. Disabled is `color-surface-muted` with
 * `color-ink-muted` text; the focus ring is 2 px `color-focus`, offset 2 px.
 */
export function Button({
  children,
  onClick,
  variant = "primary",
  icon: Icon,
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
      className={`${BASE} ${VARIANTS[variant]} ${block ? "w-full" : ""}`}
    >
      {loading ? (
        <LoaderCircle
          size={20}
          aria-hidden="true"
          className="animate-spin [animation-duration:var(--duration-spin)] motion-reduce:animate-none"
        />
      ) : Icon ? (
        <Icon size={20} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
