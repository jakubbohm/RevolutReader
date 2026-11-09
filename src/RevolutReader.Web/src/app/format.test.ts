import { expect, test } from "vitest";
import { inTimeZone } from "../test/timeZone";
import { formatCzkApprox, formatDayHeader, formatEur } from "./format";

// The list's formats (c010 design.md D4, D6, D14, translated from the design system's formats): the day headings, euro
// amounts with their sign, and the koruna value. Where a task names the no-break space (U+00A0) or the minus sign
// (U+2212), the expected string is exact; elsewhere every kind of space reads as one, as on the screen. Dates are the
// API's calendar dates (`yyyy-MM-dd`); "now" is a wall-clock time on the phone (the local-time Date constructor, months
// from 0: 10 is November), so the tests pass in any time zone. Amounts are made up; the rate is C13's.

const NO_BREAK_SPACE = " ";
const MINUS = "−";
const RATE = 24.3;

/** 2026-11-20 at 10:00 on the phone's clock, a Friday. */
const NOW = new Date(2026, 10, 20, 10, 0);

/** The text with every run of spaces, no-break ones included, read as one plain space. */
function spaced(text: string): string {
  return text.replace(/\s+/g, " ");
}

// ---- Slice 18: days ----

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
  expect(formatEur(1234.5)).toBe(`1${NO_BREAK_SPACE}234,50${NO_BREAK_SPACE}€`);
  expect(formatEur(-12.3, { signed: true })).toBe(
    `${MINUS}12,30${NO_BREAK_SPACE}€`,
  );
  expect(formatEur(50, { signed: true })).toBe(`+50,00${NO_BREAK_SPACE}€`);
});

// ---- Slice 19: a row's amounts ----

test('The koruna value is the amount\'s size times the rate, rounded half up to whole crowns, marked "≈"', () => {
  // 12.30 × 24.3 = 298.89
  expect(spaced(formatCzkApprox(-12.3, RATE))).toBe("≈ 299 Kč");
  // 5.00 × 24.3 = 121.5, exactly half: up, for money spent and received alike.
  expect(spaced(formatCzkApprox(-5, RATE))).toBe("≈ 122 Kč");
  expect(spaced(formatCzkApprox(5, RATE))).toBe("≈ 122 Kč");
});
