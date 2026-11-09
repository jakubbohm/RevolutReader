// Czech formats for the balance header (c009 design.md D10), translated from the design system's formats: a no-break
// space (U+00A0) inside amounts and between a number and its unit, so a line never breaks inside one, and U+2212 for
// minus.

const NO_BREAK_SPACE = " ";
const MINUS = "−";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Under this many minutes the freshness line counts hours (`před 2 h`); from then on it names the time. */
const COUNTS_HOURS_UNDER_MINUTES = 180;

const euros = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "EUR",
  useGrouping: true,
});

const wholeKoruna = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: true,
});

/** An amount in euros, as `286,40 €`; thousands grouped (`2 486,40 €`), whatever the amount's size. */
export function formatEur(amount: number): string {
  return asOnScreen(euros.format(amount));
}

/** The amount's koruna value, rounded to whole crowns, its size only, as `≈ 6 960 Kč`. */
export function formatCzkApprox(eurAmount: number, rate: number): string {
  return `≈${NO_BREAK_SPACE}${korunaValue(eurAmount, rate)}`;
}

/** The koruna value as a screen reader says it, as `přibližně 6 960 Kč`. */
export function czkApproxLabel(eurAmount: number, rate: number): string {
  return `přibližně ${korunaValue(eurAmount, rate)}`;
}

/**
 * When the server read the balance, as the freshness line says it: `Aktualizováno právě teď` under a minute,
 * `před 2 min` under an hour, `před 2 h` under three hours; after that the time it was read: `v 9:05` today,
 * `včera v 14:05` yesterday, else `3. 11. v 14:05`, with the year after the month outside this year
 * (`3. 11. 2025 v 14:05`). Days are calendar days in the phone's time zone.
 */
export function formatUpdated(readAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - readAt.getTime()) / MINUTE_MS);
  if (minutes < 1) return "Aktualizováno právě teď";
  if (minutes < 60) return `Aktualizováno před ${minutes}${NO_BREAK_SPACE}min`;
  if (minutes < COUNTS_HOURS_UNDER_MINUTES)
    return `Aktualizováno před ${Math.floor(minutes / 60)}${NO_BREAK_SPACE}h`;

  const at = `v${NO_BREAK_SPACE}${formatTime(readAt)}`;
  const daysAgo = calendarDaysBetween(readAt, now);
  if (daysAgo === 0) return `Aktualizováno ${at}`;
  if (daysAgo === 1) return `Aktualizováno včera ${at}`;

  const year =
    readAt.getFullYear() === now.getFullYear()
      ? ""
      : `${NO_BREAK_SPACE}${readAt.getFullYear()}`;
  return `Aktualizováno ${readAt.getDate()}.${NO_BREAK_SPACE}${readAt.getMonth() + 1}.${year} ${at}`;
}

/** The koruna value's size in whole crowns (half up), as `6 960 Kč`. */
function korunaValue(eurAmount: number, rate: number): string {
  return asOnScreen(wholeKoruna.format(Math.round(Math.abs(eurAmount) * rate)));
}

/** The time of day, hours without a leading zero: `9:05`, `14:05`. */
function formatTime(time: Date): string {
  return `${time.getHours()}:${String(time.getMinutes()).padStart(2, "0")}`;
}

/** How many calendar days lie between the two moments' dates; rounded, so a daylight-saving change counts as a day. */
function calendarDaysBetween(earlier: Date, later: Date): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / DAY_MS);
}

function startOfDay(moment: Date): number {
  return new Date(
    moment.getFullYear(),
    moment.getMonth(),
    moment.getDate(),
  ).getTime();
}

/**
 * The formatter's text as the design writes it, whatever the browser's number data: every space a no-break space,
 * every hyphen-minus U+2212.
 */
function asOnScreen(text: string): string {
  return text.replace(/\s/g, NO_BREAK_SPACE).replace(/-/g, MINUS);
}
