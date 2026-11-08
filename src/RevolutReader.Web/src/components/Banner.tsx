import { CircleAlert } from "lucide-react";
import type { JSX, ReactNode } from "react";

export interface BannerProps {
  /** The banner's tone; the info and warning tones join when a screen needs them. */
  tone: "error";
  /** A short title, in the tone's colour. */
  title?: string;
  /** One sentence, in ink. */
  children?: ReactNode;
}

/**
 * A short inline message (design system Banner, c007 design.md D12). The error tone: the `color-danger-soft` fill, the
 * `circle-alert` icon and the title in `color-danger`, the sentence in ink, announced as an alert. The tone shows in the
 * icon and the words as well as the fill. A long word, such as an email address, wraps rather than overflowing.
 */
export function Banner({ title, children }: BannerProps): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-card bg-danger-soft pt-row pr-2 pb-row pl-gutter"
    >
      <CircleAlert
        size={20}
        aria-hidden="true"
        className="mt-px flex-none text-danger"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        {title ? <p className="text-body-strong text-danger">{title}</p> : null}
        {children ? (
          <p className="text-subhead wrap-anywhere text-ink">{children}</p>
        ) : null}
      </div>
    </div>
  );
}
