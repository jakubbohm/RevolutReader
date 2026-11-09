import { expect, test } from "vitest";
import { inTimeZone } from "../test/timeZone";
import {
  czkApproxLabel,
  formatCzkApprox,
  formatDate,
  formatDayHeader,
  formatEur,
  formatRate,
  formatUpdated,
} from "./format";

// The Czech formats of the balance header (c009 design.md D10, from the design system's formats): euros with a decimal
// comma, koruna rounded to whole crowns after "≈", and the freshness line. Where a task names the no-break space
// (U+00A0), the expected string is exact; elsewhere every kind of space reads as one, as on the screen. The amounts are
// made up; the rate is C13's. Times are local wall-clock times (the local-time Date constructor), so the tests pass in
// any time zone; months count from 0 (10 is November).
//
// The list's formats (c010 design.md D4, D6, D14, translated from the design system's formats), in the blocks marked
// "c010": the day headings, euro amounts with their sign, the koruna value's rounding, and the sheet's date and rate line. Where a task names the minus
// sign (U+2212), the expected string is exact. Dates are the API's calendar dates (`yyyy-MM-dd`); "now" is a wall-clock
// time on the phone, as above.

const NO_BREAK_SPACE = " ";
const RATE = 24.3;

/** The text with every run of spaces, no-break ones included, read as one plain space. */
function spaced(text: string): string {
  return text.replace(/\s+/g, " ");
}

test("An amount shows in euros with a decimal comma and a no-break space before € (286,40 €)", () => {
  expect(formatEur(286.4)).toBe(`286,40${NO_BREAK_SPACE}€`);
});

test("A four-digit amount groups its thousands with a no-break space (2 486,40 €)", () => {
  expect(formatEur(2486.4)).toBe(`2${NO_BREAK_SPACE}486,40${NO_BREAK_SPACE}€`);
});

test("The koruna value is the amount times the rate, rounded to whole crowns, after ≈ (≈ 6 960 Kč)", () => {
  // 286.40 × 24.3 = 6 959.52
  expect(spaced(formatCzkApprox(286.4, RATE))).toBe("≈ 6 960 Kč");
});

test("The koruna value of a negative amount shows its size without a sign", () => {
  expect(spaced(formatCzkApprox(-286.4, RATE))).toBe("≈ 6 960 Kč");
});

test("The spoken koruna value reads přibližně 6 960 Kč", () => {
  expect(spaced(czkApproxLabel(286.4, RATE))).toBe("přibližně 6 960 Kč");
});

test("A balance read under a minute ago is Aktualizováno právě teď", () => {
  const now = new Date(2026, 10, 10, 14, 5, 0);
  const readAt = new Date(2026, 10, 10, 14, 4, 30);

  expect(spaced(formatUpdated(readAt, now))).toBe("Aktualizováno právě teď");
});

test("A balance read 2 minutes ago is Aktualizováno před 2 min", () => {
  const now = new Date(2026, 10, 10, 14, 5);
  const readAt = new Date(2026, 10, 10, 14, 3);

  expect(spaced(formatUpdated(readAt, now))).toBe("Aktualizováno před 2 min");
});

test("A balance read 2 hours ago is Aktualizováno před 2 h", () => {
  const now = new Date(2026, 10, 10, 14, 5);
  const readAt = new Date(2026, 10, 10, 12, 5);

  expect(spaced(formatUpdated(readAt, now))).toBe("Aktualizováno před 2 h");
});

test("A balance read earlier today is Aktualizováno v 9:05", () => {
  const now = new Date(2026, 10, 10, 14, 5);
  const readAt = new Date(2026, 10, 10, 9, 5);

  expect(spaced(formatUpdated(readAt, now))).toBe("Aktualizováno v 9:05");
});

test("A balance read yesterday is Aktualizováno včera v 14:05", () => {
  const now = new Date(2026, 10, 10, 14, 5);
  const readAt = new Date(2026, 10, 9, 14, 5);

  expect(spaced(formatUpdated(readAt, now))).toBe(
    "Aktualizováno včera v 14:05",
  );
});

test("A balance read on another day this year is Aktualizováno 3. 11. v 14:05, and in another year its year follows the month", () => {
  const now = new Date(2026, 10, 10, 14, 5);

  expect(spaced(formatUpdated(new Date(2026, 10, 3, 14, 5), now))).toBe(
    "Aktualizováno 3. 11. v 14:05",
  );
  expect(spaced(formatUpdated(new Date(2025, 10, 3, 14, 5), now))).toBe(
    "Aktualizováno 3. 11. 2025 v 14:05",
  );
});

// ---- c010, Slice 18: days ----

const MINUS = "−";

/** 2026-11-20 at 10:00 on the phone's clock, a Friday. */
const NOW = new Date(2026, 10, 20, 10, 0);

test("A date reads as a local calendar day, whatever the time zone", () => {
  // West of Greenwich the API's date read as UTC midnight is the day before, and late in the evening it is already the
  // next day in UTC.
  inTimeZone("America/Los_Angeles", () => {
    const lateInTheEvening = new Date(2026, 10, 20, 23, 30);

    expect(formatDayHeader("2026-11-20", lateInTheEvening)).toBe("Dnes");
    expect(formatDayHeader("2026-11-19", lateInTheEvening)).toBe("Včera");
    expect(spaced(formatDayHeader("2026-11-18", lateInTheEvening))).toBe(
      "středa 18. listopadu",
    );
  });
  // East of Greenwich, just after midnight it is still the day before in UTC.
  inTimeZone("Asia/Tokyo", () => {
    const justAfterMidnight = new Date(2026, 10, 20, 0, 30);

    expect(formatDayHeader("2026-11-20", justAfterMidnight)).toBe("Dnes");
    expect(formatDayHeader("2026-11-19", justAfterMidnight)).toBe("Včera");
  });
});

test(`Today's heading is "Dnes" and yesterday's "Včera"`, () => {
  expect(formatDayHeader("2026-11-20", NOW)).toBe("Dnes");
  expect(formatDayHeader("2026-11-19", NOW)).toBe("Včera");
  // Across the end of a month and of a year.
  expect(formatDayHeader("2026-10-31", new Date(2026, 10, 1, 10, 0))).toBe(
    "Včera",
  );
  expect(formatDayHeader("2025-12-31", new Date(2026, 0, 1, 10, 0))).toBe(
    "Včera",
  );
});

test("An older day's heading is its weekday and date, with the year only outside the current year", () => {
  expect(spaced(formatDayHeader("2026-11-18", NOW))).toBe(
    "středa 18. listopadu",
  );
  expect(spaced(formatDayHeader("2026-01-05", NOW))).toBe("pondělí 5. ledna");
  expect(spaced(formatDayHeader("2025-11-18", NOW))).toBe(
    "úterý 18. listopadu 2025",
  );
  // Two days ago, but in the year before.
  expect(
    spaced(formatDayHeader("2025-12-30", new Date(2026, 0, 1, 10, 0))),
  ).toBe("úterý 30. prosince 2025");
});

test("Euro amounts are formatted the Czech way, with the minus sign U+2212 and a non-breaking space", () => {
  // The unsigned format and its thousands are pinned by C7a's tests above.
  expect(formatEur(-12.3, { signed: true })).toBe(
    `${MINUS}12,30${NO_BREAK_SPACE}€`,
  );
  expect(formatEur(50, { signed: true })).toBe(`+50,00${NO_BREAK_SPACE}€`);
});

// ---- c010, Slice 19: a row's amounts ----

test('The koruna value is the amount\'s size times the rate, rounded half up to whole crowns, marked "≈"', () => {
  // Ordinary rounding and a negative amount's size are pinned by C7a's tests above.
  // 5.00 × 24.3 = 121.5, exactly half: up, for money spent and received alike.
  expect(spaced(formatCzkApprox(-5, RATE))).toBe("≈ 122 Kč");
  expect(spaced(formatCzkApprox(5, RATE))).toBe("≈ 122 Kč");
});

// ---- c010, Slice 23: the sheet's formats (D4d) ----

/** C13's `KorunaRate.Date`, as the API answers it. */
const RATE_DATE = "2026-11-08";

test('The rate line reads "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026"', () => {
  expect(spaced(formatRate(RATE, RATE_DATE))).toBe(
    "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026",
  );
  // The rate always to two decimals; the date as the API's calendar day, west of Greenwich too.
  inTimeZone("America/Los_Angeles", () => {
    expect(spaced(formatRate(25, "2026-01-05"))).toBe(
      "1 € ≈ 25,00 Kč · orientační kurz z 5. 1. 2026",
    );
  });
});

test('A date reads "18. 11. 2026"', () => {
  expect(spaced(formatDate("2026-11-18"))).toBe("18. 11. 2026");
  // Day and month without a leading zero.
  expect(spaced(formatDate("2026-01-05"))).toBe("5. 1. 2026");
  // The API's calendar day in any time zone: read as UTC midnight, it would be the day before west of Greenwich.
  inTimeZone("America/Los_Angeles", () => {
    expect(spaced(formatDate("2026-11-18"))).toBe("18. 11. 2026");
  });
  inTimeZone("Asia/Tokyo", () => {
    expect(spaced(formatDate("2026-11-18"))).toBe("18. 11. 2026");
  });
});
