import type { JSX } from "react";

export interface WakingUpProps {
  /** The first request has had no answer for 30 s: the slow variant, with "Zkusit znovu". */
  slow: boolean;
  /** "Zkusit znovu" in the slow variant. */
  onRetry: () => void;
}

/**
 * The waking-up screen (design system WakingUp, c009 design.md D10). A stub until c009 tasks.md group 37 is
 * implemented; `void` keeps the unused-parameter check quiet until then.
 */
export function WakingUp(props: WakingUpProps): JSX.Element {
  void props;
  throw new Error("not implemented");
}
