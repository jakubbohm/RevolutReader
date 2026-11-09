import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, type JSX, type Ref } from "react";
import { Button } from "./Button";

export interface ListEndProps {
  /** `loading` while older pages may exist, `error` when the last one failed, `end` where the history ends. */
  state: "loading" | "error" | "end";
  /** "Zkusit znovu" in the `error` state. */
  onRetry?: () => void;
  /** The end's element, for the observer that asks the next older page when it comes near. */
  ref?: Ref<HTMLDivElement>;
}

/** What the status line says in each state. */
const TEXT = {
  loading: "Načítám starší pohyby",
  error: "Starší pohyby se nepodařilo načíst",
  end: "Žádné starší pohyby",
} as const;

/** The status line's type and colour in each state. */
const LINE = {
  loading: "text-subhead text-ink-muted",
  error: "text-subhead text-ink",
  end: "text-footnote text-ink-muted",
} as const;

/**
 * The end of the transaction list, under the last day (design system ListEnd, c010 design.md D1, D14): `loading`, the
 * spinning `loader-circle` and "Načítám starší pohyby", shown whenever older pages may exist, so it is already there
 * when the user gets to it; `error`, `circle-alert` in `color-danger` and "Starší pohyby se nepodařilo načíst", with a
 * ghost "Zkusit znovu" under it; `end`, the one quiet line "Žádné starší pohyby".
 *
 * A centred column inside the gutter, at least `spacing-touch` tall. The line is one `p`, a polite live region read
 * whole, kept mounted across the states, so each change is announced once and the unchanged loading line is not
 * repeated; it is not an alert, since nobody asked for this page and the rows above still work. The design system gives
 * it `role="status"`; `aria-live="polite"` with `aria-atomic` is announced the same, and leaves the screen's one status
 * to what the screen says of itself (the signed-out note, the placeholders). Tapping "Zkusit znovu" moves the focus to
 * the line before the button goes, so VoiceOver stays at the end of the list. `overflow-anchor: none`: the browser never
 * keeps the end in place while new days come in above it. Under reduced motion the spinner stands still.
 */
export function ListEnd({ state, onRetry, ref }: ListEndProps): JSX.Element {
  const line = useRef<HTMLParagraphElement>(null);

  function retry(): void {
    line.current?.focus({ preventScroll: true });
    onRetry?.();
  }

  return (
    <div
      ref={ref}
      className="flex min-h-touch flex-col items-center justify-center gap-1 px-gutter text-center [overflow-anchor:none]"
    >
      <p
        ref={line}
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
        className={`flex items-center gap-2 ${LINE[state]}`}
      >
        {state === "loading" ? (
          <LoaderCircle
            size={20}
            aria-hidden="true"
            className="animate-busy-spin"
          />
        ) : state === "error" ? (
          <CircleAlert size={20} aria-hidden="true" className="text-danger" />
        ) : null}
        {TEXT[state]}
      </p>
      {state === "error" ? (
        <Button variant="ghost" icon={RefreshCw} onClick={retry}>
          Zkusit znovu
        </Button>
      ) : null}
    </div>
  );
}
