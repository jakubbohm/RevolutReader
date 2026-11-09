import type { LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";

export type EmptyStateProps =
  | {
      /** The default: the icon in its disc, the title and the sentence. */
      variant?: "default";
      title: string;
      /** A Lucide icon, such as `WifiOff`. */
      icon: LucideIcon;
      /** One sentence. */
      children: ReactNode;
    }
  | {
      /** One muted line, no disc and no title, under the content it belongs to. */
      variant: "note";
      children: ReactNode;
    };

/**
 * What stands in for content there is nothing of yet (design system EmptyState, c009 design.md D10), centred. The
 * default: a 56 pt `color-surface-muted` disc with the icon in `color-ink-muted`, the title in `text-title` and the
 * sentence in muted `text-body`. The note: one line of muted `text-subhead`, padded 8 × 32. No illustration, no emoji,
 * and no default texts: each use names its own.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
  if (props.variant === "note")
    return (
      <p className="px-8 py-2 text-center text-subhead text-ink-muted">
        {props.children}
      </p>
    );

  const { title, icon: Icon, children } = props;
  return (
    <div className="flex flex-col items-center gap-2 px-gutter text-center">
      <span
        aria-hidden="true"
        className="mb-2 flex size-14 items-center justify-center rounded-full bg-surface-muted text-ink-muted"
      >
        <Icon size={28} />
      </span>
      <p className="text-title text-ink">{title}</p>
      <p className="text-body text-ink-muted">{children}</p>
    </div>
  );
}
