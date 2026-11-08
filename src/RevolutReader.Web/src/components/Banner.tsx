import {
  CircleAlert,
  Info,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "./Button";

export interface BannerProps {
  /** The banner's tone (c009 design.md D10): info and warning are announced as a status, error as an alert. */
  tone: "info" | "warning" | "error";
  /** A short title: in `color-danger` for an error, in ink otherwise. */
  title?: string;
  /** One sentence, in ink. */
  children?: ReactNode;
  /** At most one action, a ghost button under the text; while `loading`, it ignores taps (c009 design.md D10). */
  action?: { label: string; onClick: () => void; loading?: boolean };
  /** An icon in place of the tone's own: `wifi-off` for offline (c009 design.md D10). */
  icon?: "wifi-off";
}

/** Each tone's role, fill, icon and colours (design system Banner). */
const tones = {
  info: {
    role: "status",
    fill: "bg-info-soft",
    icon: Info,
    iconColour: "text-info",
    titleColour: "text-ink",
  },
  warning: {
    role: "status",
    fill: "bg-warning-soft",
    icon: TriangleAlert,
    iconColour: "text-warning",
    titleColour: "text-ink",
  },
  error: {
    role: "alert",
    fill: "bg-danger-soft",
    icon: CircleAlert,
    iconColour: "text-danger",
    titleColour: "text-danger",
  },
} as const satisfies Record<
  BannerProps["tone"],
  {
    role: "status" | "alert";
    fill: string;
    icon: LucideIcon;
    iconColour: string;
    titleColour: string;
  }
>;

/** The icons a banner may take in place of its tone's own. */
const icons: Record<NonNullable<BannerProps["icon"]>, LucideIcon> = {
  "wifi-off": WifiOff,
};

/**
 * A short inline message (design system Banner, c007 design.md D12, c009 D10), one per screen, in its tone's soft fill
 * with its icon in the tone's colour:
 * - info: `color-info-soft`, `info`; warning: `color-warning-soft`, `triangle-alert` (`wifi-off` when offline); both
 *   announced as a status;
 * - error: `color-danger-soft`, `circle-alert`, the title in `color-danger`; announced as an alert.
 *
 * The sentence is ink in `text-subhead`; the tone shows in the icon and the words as well as the fill. Its one action
 * is a ghost button under the text, its label in line with the text. A long word, such as an email address, wraps
 * rather than overflowing.
 */
export function Banner({
  tone,
  title,
  children,
  action,
  icon,
}: BannerProps): JSX.Element {
  const look = tones[tone];
  const Icon = icon === undefined ? look.icon : icons[icon];

  return (
    <div
      role={look.role}
      className={`flex items-start gap-3 rounded-card pt-row pr-2 pb-row pl-gutter ${look.fill}`}
    >
      <Icon
        size={20}
        aria-hidden="true"
        className={`mt-px flex-none ${look.iconColour}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        {title ? (
          <p className={`text-body-strong ${look.titleColour}`}>{title}</p>
        ) : null}
        {children ? (
          <p className="text-subhead wrap-anywhere text-ink">{children}</p>
        ) : null}
        {action ? (
          <div className="-ml-gutter self-start">
            <Button
              variant="ghost"
              loading={action.loading}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
