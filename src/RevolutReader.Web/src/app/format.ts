// The list's Czech formats (c010 design.md D4, D6, D14), translated from the design system's formats: a no-break space
// (U+00A0) inside amounts and between a number and its unit, and U+2212 for minus. At the join with C7a (D13) this file
// is merged by hand with C7a's copy: one `formatEur`, `formatCzkApprox` and `czkApproxLabel`.
// Stubs until c010 tasks.md tasks 41.1 and 44.1 are implemented; `void` keeps the unused-parameter check quiet until then.

/** An amount in euros, as `1 234,50 €`; with `signed`, with its sign: `−12,30 €`, `+50,00 €`. */
export function formatEur(
  amount: number,
  options?: { signed?: boolean },
): string {
  void amount;
  void options;
  throw new Error("not implemented");
}

/** The amount's koruna value at `rate`: its size only, rounded half up to whole crowns, after "≈", as `≈ 299 Kč`. */
export function formatCzkApprox(eurAmount: number, rate: number): string {
  void eurAmount;
  void rate;
  throw new Error("not implemented");
}

/** The koruna value as a screen reader says it, as `přibližně 299 Kč`. */
export function czkApproxLabel(eurAmount: number, rate: number): string {
  void eurAmount;
  void rate;
  throw new Error("not implemented");
}

/**
 * A row's amount with its sign: in euros as `formatEur` writes it (`−12,30 €`), in another currency with its ISO code
 * (`−12,30 USD`; c010 design.md D4).
 */
export function formatAmount(amount: number, currency: string): string {
  void amount;
  void currency;
  throw new Error("not implemented");
}

/**
 * A day's heading for the API's calendar date (`yyyy-MM-dd`) as of `now`, both in the phone's time zone: `Dnes`, `Včera`,
 * else the weekday and the date (`středa 18. listopadu`), with the year outside `now`'s year.
 */
export function formatDayHeader(date: string, now: Date): string {
  void date;
  void now;
  throw new Error("not implemented");
}
