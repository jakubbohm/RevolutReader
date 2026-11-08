import * as Progress from "@radix-ui/react-progress";
import { Moon, RefreshCw } from "lucide-react";
import type { JSX } from "react";
import { Button } from "./Button";

export interface WakingUpProps {
  /** The first request has had no answer for 30 s: the slow variant, with "Zkusit znovu". */
  slow: boolean;
  /** "Zkusit znovu" in the slow variant. */
  onRetry: () => void;
}

/**
 * The waking-up screen (design system WakingUp, c009 design.md D2, D10), while the sleeping server starts, so a long
 * first load reads as expected rather than broken: a card with the 56 pt `color-accent-soft` disc and `moon`, "Server
 * se probouzí" (`text-title`), its sentence (muted `text-body`), and a thin indeterminate bar in `color-accent`, Radix
 * `Progress` with no value, so it waits rather than counts. Announced as a status. Under reduced motion the bar stands
 * still as a half-tone bar across the track. The slow variant says it takes longer than usual and offers "Zkusit znovu",
 * a secondary button across the card.
 */
export function WakingUp({ slow, onRetry }: WakingUpProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-gutter py-section text-center shadow-card"
    >
      <span
        aria-hidden="true"
        className="mb-2 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <Moon size={26} />
      </span>
      <p className="text-title text-ink">Server se probouzí</p>
      <p className="text-body text-ink-muted">
        {slow
          ? "Trvá to déle než obvykle. Zkontroluj připojení, nebo to zkus znovu."
          : "Když ho chvíli nikdo nepoužívá, usne. První načtení trvá asi 20 sekund."}
      </p>
      <Progress.Root
        value={null}
        aria-label="Probouzení serveru"
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-accent-soft"
      >
        <Progress.Indicator className="h-full w-2/5 animate-progress-indeterminate rounded-full bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
      </Progress.Root>
      {slow ? (
        <div className="mt-3 w-full">
          <Button variant="secondary" block icon={RefreshCw} onClick={onRetry}>
            Zkusit znovu
          </Button>
        </div>
      ) : null}
    </div>
  );
}
