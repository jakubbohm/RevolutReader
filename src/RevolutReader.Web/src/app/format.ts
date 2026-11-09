// The list's Czech formats (c010 design.md D4, D6, D14), translated from the design system's formats: a no-break space
// (U+00A0) inside amounts and between a number and its unit, and U+2212 for minus. At the join with C7a (D13) this file
// is merged by hand with C7a's copy: one `formatEur`, `formatCzkApprox` and `czkApproxLabel`.

const NO_BREAK_SPACE = " ";
const MINUS = "−";
const MS_PER_DAY = 86_400_000;

/** Euros the Czech way; grouping forced, so four-digit amounts are grouped in every engine (design system). */
const EUR = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "EUR",
  useGrouping: true,
});
const EUR_SIGNED = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "EUR",
  signDisplay: "exceptZero",
  useGrouping: true,
});
/** An amount in any other currency, without its unit: the ISO code is written after it as it comes. */
const OTHER_CURRENCY_SIGNED = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
  useGrouping: true,
});
const WHOLE_CROWNS = new Intl.NumberFormat("cs-CZ", {
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
const DAY_HEADING = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const DAY_HEADING_WITH_YEAR = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Evens out the engines: any space inside a formatted number becomes a no-break space, a hyphen-minus U+2212. */
function czech(formatted: string): string {
  return formatted.replace(/[  ]/g, NO_BREAK_SPACE).replace(/-/g, MINUS);
}

/** An amount in euros, as `1 234,50 €`; with `signed`, with its sign: `−12,30 €`, `+50,00 €`. */
export function formatEur(
  amount: number,
  options: { signed?: boolean } = {},
): string {
  return czech((options.signed ? EUR_SIGNED : EUR).format(amount));
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

/** The amount's koruna value at `rate`: its size only, rounded half up to whole crowns, after "≈", as `≈ 299 Kč`. */
export function formatCzkApprox(eurAmount: number, rate: number): string {
  return `≈${NO_BREAK_SPACE}${czech(WHOLE_CROWNS.format(wholeCrowns(eurAmount, rate)))}`;
}

/** The koruna value as a screen reader says it, as `přibližně 299 Kč`. */
export function czkApproxLabel(eurAmount: number, rate: number): string {
  return `přibližně ${czech(WHOLE_CROWNS.format(wholeCrowns(eurAmount, rate)))}`;
}

/**
 * A row's amount with its sign: in euros as `formatEur` writes it (`−12,30 €`), in another currency with its ISO code
 * (`−12,30 USD`; c010 design.md D4).
 */
export function formatAmount(amount: number, currency: string): string {
  if (currency === "EUR") return formatEur(amount, { signed: true });

  return `${czech(OTHER_CURRENCY_SIGNED.format(amount))}${NO_BREAK_SPACE}${currency}`;
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
  const daysAgo = Math.round((today - midnight) / MS_PER_DAY);

  if (daysAgo === 0) return "Dnes";
  if (daysAgo === 1) return "Včera";

  const heading =
    year === now.getFullYear() ? DAY_HEADING : DAY_HEADING_WITH_YEAR;
  // A no-break space before each number keeps it with the word before it, as the design system writes the heading.
  return heading.format(midnight).replace(/\s(?=\d)/g, NO_BREAK_SPACE);
}
