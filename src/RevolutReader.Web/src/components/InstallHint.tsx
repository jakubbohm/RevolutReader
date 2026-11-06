import { Ellipsis, Share, SquarePlus } from "lucide-react";
import type { JSX } from "react";

/** A Lucide icon inside a sentence, in the accent colour (design system `.tp-inline-icon`). */
const INLINE_ICON = "mx-0.5 inline-block align-[-3px] text-accent";
const INLINE_ICON_SIZE = 18;

/** A step's number in its disc (design system `.tp-step-n`). */
const STEP_NUMBER =
  "inline-flex size-6 flex-none items-center justify-center rounded-full bg-accent-soft text-caption text-accent";

/**
 * The screen in a browser tab on an iPhone, shown instead of the app: how to add the app to the Home Screen, where
 * notifications work (design system InstallHint, laid out as the Screens artboard "Shell / Safari / Install hint",
 * c003 design.md D4). The steps follow Safari on iOS 26.
 */
export function InstallHint(): JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col gap-section pt-[calc(env(safe-area-inset-top,0px)_+_var(--spacing-section)_*_2)] pr-[env(safe-area-inset-right,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-section))] pl-[env(safe-area-inset-left,0px)]">
      <div className="flex flex-col items-center gap-3 px-gutter text-center">
        <img
          src="/app-icon.svg"
          width={64}
          height={64}
          alt=""
          className="block size-16 rounded-card"
        />
        <h1 className="text-title" lang="es">
          Tarjeta Papá
        </h1>
        <p className="text-body text-ink-muted">
          Uvidíš tu zůstatek a pohyby na tátově eurovém účtu.
        </p>
      </div>
      <div className="mx-gutter flex flex-col gap-2 rounded-card border border-border bg-surface p-gutter shadow-card">
        <h2 className="text-headline">Nejdřív si appku přidej na plochu</h2>
        <p className="text-body text-ink-muted">
          Upozornění na iPhonu fungují jen v appce otevřené z plochy.
        </p>
        <ol className="mt-1 flex flex-col gap-3">
          <li className="flex items-start gap-3">
            <span className={STEP_NUMBER}>1</span>
            <span className="text-body">
              V Safari klepni na{" "}
              <Ellipsis
                size={INLINE_ICON_SIZE}
                role="img"
                aria-label="tři tečky"
                className={INLINE_ICON}
              />{" "}
              vedle adresy a pak na <b className="font-semibold">Sdílet</b>{" "}
              <Share size={INLINE_ICON_SIZE} className={INLINE_ICON} />
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={STEP_NUMBER}>2</span>
            <span className="text-body">
              Sjeď níž a vyber <b className="font-semibold">Přidat na plochu</b>{" "}
              <SquarePlus size={INLINE_ICON_SIZE} className={INLINE_ICON} />
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={STEP_NUMBER}>3</span>
            <span className="text-body">
              Klepni na <b className="font-semibold">Přidat</b> a otevři{" "}
              <span lang="es">Tarjeta Papá</span> z plochy.
            </span>
          </li>
        </ol>
      </div>
    </main>
  );
}
