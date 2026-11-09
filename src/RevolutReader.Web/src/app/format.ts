// Czech formats for the balance header (c009 design.md D10) and the transaction list (c010 design.md D4, D6, D14),
// translated from the design system's formats: a no-break space (U+00A0) inside amounts and between a number and its
// unit, so a line never breaks inside one, and U+2212 for minus.

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

const signedEuros = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "EUR",
  signDisplay: "exceptZero",
  useGrouping: true,
});

/** An amount in any other currency, without its unit: the ISO code is written after it as it comes. */
const signedOtherCurrency = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
  useGrouping: true,
});

/** The koruna rate, always to two decimals: `24,30`. */
const twoDecimals = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

const wholeKoruna = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: true,
});

/**
 * A day heading's weekday and date, read in UTC from the day's UTC midnight: the calendar day is the API's, so the
 * phone's time zone never moves it to the day before or after.
 */
const dayHeading = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const dayHeadingWithYear = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * An amount in euros, as `286,40 €`; thousands grouped (`2 486,40 €`), whatever the amount's size. With `signed`, with
 * its sign: `−12,30 €`, `+50,00 €`.
 */
export function formatEur(
  amount: number,
  options: { signed?: boolean } = {},
): string {
  return asOnScreen((options.signed ? signedEuros : euros).format(amount));
}

/** The amount's koruna value, rounded half up to whole crowns, its size only, as `≈ 6 960 Kč`. */
export function formatCzkApprox(eurAmount: number, rate: number): string {
  return `≈${NO_BREAK_SPACE}${korunaValue(eurAmount, rate)}`;
}

/** The koruna value as a screen reader says it, as `přibližně 6 960 Kč`. */
export function czkApproxLabel(eurAmount: number, rate: number): string {
  return `přibližně ${korunaValue(eurAmount, rate)}`;
}

/**
 * A row's amount with its sign: in euros as `formatEur` writes it (`−12,30 €`), in another currency with its ISO code
 * (`−12,30 USD`; c010 design.md D4).
 */
export function formatAmount(amount: number, currency: string): string {
  if (currency === "EUR") return formatEur(amount, { signed: true });

  return `${asOnScreen(signedOtherCurrency.format(amount))}${NO_BREAK_SPACE}${currency}`;
}

/**
 * A day's heading for the API's calendar date (`yyyy-MM-dd`) as of `now`, both in the phone's time zone: `Dnes`, `Včera`,
 * else the weekday and the date (`středa 18. listopadu`), with the year outside `now`'s year. The days are counted on
 * the calendar, never in hours, so a change to or from summer time counts as no day.
 */
export function formatDayHeader(date: string, now: Date): string {
  const [year, month, day] = date.split("-").map(Number);
  const midnight = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((today - midnight) / DAY_MS);

  if (daysAgo === 0) return "Dnes";
  if (daysAgo === 1) return "Včera";

  const heading = year === now.getFullYear() ? dayHeading : dayHeadingWithYear;
  // A no-break space before each number keeps it with the word before it, as the design system writes the heading.
  return heading.format(midnight).replace(/\s(?=\d)/g, NO_BREAK_SPACE);
}

/**
 * The API's calendar date (`yyyy-MM-dd`) as the sheet's "Datum" shows it, day and month without a leading zero and a
 * no-break space after each dot: `18. 11. 2026`, `5. 1. 2026`. Read from the text itself, never through a `Date`, so it
 * is the same day in any time zone (c010 design.md D4d).
 */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);

  return `${day}.${NO_BREAK_SPACE}${month}.${NO_BREAK_SPACE}${year}`;
}

/**
 * The sheet's "Přepočet na koruny" line: the koruna rate the koruna values use, to two decimals, with the API's date
 * of the rate (`yyyy-MM-dd`), as `1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026` (c010 design.md D4d). The rate itself
 * holds together with no-break spaces; the line may break before its date.
 */
export function formatRate(rate: number, rateDate: string): string {
  const korunaPerEuro = asOnScreen(twoDecimals.format(rate));

  return `1${NO_BREAK_SPACE}€${NO_BREAK_SPACE}≈${NO_BREAK_SPACE}${korunaPerEuro}${NO_BREAK_SPACE}Kč · orientační kurz z ${formatDate(rateDate)}`;
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

/** The koruna value's size in whole crowns, as `6 960 Kč`. */
function korunaValue(eurAmount: number, rate: number): string {
  return asOnScreen(wholeKoruna.format(wholeCrowns(eurAmount, rate)));
}

/**
 * The size of the amount's koruna value at `rate` in whole crowns, rounded half up (c010 design.md D6). Worked out in
 * whole numbers (cents times ten-thousandths of a crown per euro), so that no floating-point error moves a half down.
 */
function wholeCrowns(eurAmount: number, rate: number): number {
  const cents = Math.round(Math.abs(eurAmount) * 100);
  const rateInTenThousandths = Math.round(rate * 10_000);
  const millionthsOfACrown = cents * rateInTenThousandths;

  return Math.floor((millionthsOfACrown + 500_000) / 1_000_000);
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
