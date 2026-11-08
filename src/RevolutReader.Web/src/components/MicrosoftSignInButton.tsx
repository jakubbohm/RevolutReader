import { LoaderCircle } from "lucide-react";
import type { JSX } from "react";

export interface MicrosoftSignInButtonProps {
  /** Starts the sign-in at Microsoft. */
  onClick?: () => void;
  /** While the page leaves for Microsoft: a spinner beside the kept label, and `aria-busy`. */
  loading?: boolean;
}

/**
 * The sign-in button for personal Microsoft accounts (design system MicrosoftSignInButton, c007 design.md D12), to
 * Microsoft's branding guidelines: 41 px tall, square corners, 12 px insets and gap, Microsoft's logo file at 21 px
 * (never redrawn or recoloured), the label at 15 px semibold in Segoe UI where present. Its colours come from the
 * `color-ms-*` tokens, light and dark. The face is 41 px; an invisible pseudo-element extends the hit area to 44 pt
 * (`spacing-touch`): it is placed against the padding box, inside the 1 px border, so it reaches 2.5 px beyond it above
 * and below. The label is the accessible name; the logo has no text of its own.
 */
export function MicrosoftSignInButton({
  onClick,
  loading = false,
}: MicrosoftSignInButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={loading || undefined}
      className="relative inline-flex h-[41px] items-center gap-3 border border-ms-border bg-ms-surface px-3 font-['Segoe_UI',var(--font-sans)] text-[15px] leading-5 font-semibold text-ms-text transition-transform duration-(--duration-fast) ease-standard before:absolute before:inset-x-0 before:-inset-y-[2.5px] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <img
        src="/microsoft-logo.svg"
        width={21}
        height={21}
        alt=""
        className="block size-[21px]"
      />
      <span>Přihlásit se účtem Microsoft</span>
      {loading ? (
        <LoaderCircle
          size={18}
          aria-hidden="true"
          className="animate-spin [animation-duration:var(--duration-spin)] motion-reduce:animate-none"
        />
      ) : null}
    </button>
  );
}
