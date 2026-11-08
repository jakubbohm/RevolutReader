import { expect, test } from "vitest";
import {
  czkApproxLabel,
  formatCzkApprox,
  formatEur,
  formatUpdated,
} from "./format";

// The Czech formats of the balance header (c009 design.md D10, from the design system's formats): euros with a decimal
// comma, koruna rounded to whole crowns after "≈", and the freshness line. Where a task names the no-break space
// (U+00A0), the expected string is exact; elsewhere every kind of space reads as one, as on the screen. The amounts are
// made up; the rate is C13's. Times are local wall-clock times (the local-time Date constructor), so the tests pass in
// any time zone; months count from 0 (10 is November).

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
