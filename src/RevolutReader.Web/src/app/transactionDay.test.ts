import { expect, test } from "vitest";
import { inTimeZone } from "../test/timeZone";
import { approxTime, transactionDay } from "./transactionDay";

// A transaction's approximate time and its day (c018 design.md D6): `seenAt` is when the app first got the transaction
// from the bank, an instant the API answers in UTC (`+00:00`); its local date on the phone is the transaction's day,
// which can differ from the bank's `date`, a UTC date. The transactions are made up.

test("`approxTime` gives `seenAt` as a date, and none when it is null or does not parse", () => {
  expect(
    approxTime({ seenAt: "2026-11-14T23:20:00+00:00" }),
    "the API's form, offset zero",
  ).toEqual(new Date(Date.UTC(2026, 10, 14, 23, 20, 0)));
  expect(
    approxTime({ seenAt: "2026-11-18T13:05:12Z" }),
    "the same instant written with Z",
  ).toEqual(new Date(Date.UTC(2026, 10, 18, 13, 5, 12)));

  expect(approxTime({ seenAt: null }), "no time").toBeNull();
  expect(
    approxTime({ seenAt: "kolem poledne" }),
    "text that does not parse",
  ).toBeNull();
  expect(approxTime({ seenAt: "" }), "empty text").toBeNull();
});

test("`transactionDay` is the local date of the time when there is one, else `date`; in Prague, 2026-11-14 23:20:00 UTC is 2026-11-15, and in Los Angeles it is 2026-11-14", () => {
  const transferFromDad = {
    date: "2026-11-14",
    seenAt: "2026-11-14T23:20:00+00:00",
  };

  inTimeZone("Europe/Prague", () => {
    // 0:20 on 15 November in Prague (UTC+1).
    expect(transactionDay(transferFromDad)).toBe("2026-11-15");
    // A time on the same local date as the bank's date leaves the day as it is.
    expect(
      transactionDay({
        date: "2026-11-18",
        seenAt: "2026-11-18T13:05:12+00:00",
      }),
    ).toBe("2026-11-18");
    // Without a time, or with one that does not parse, the day is the bank's date.
    expect(transactionDay({ date: "2026-11-14", seenAt: null })).toBe(
      "2026-11-14",
    );
    expect(
      transactionDay({ date: "2026-11-14", seenAt: "kolem poledne" }),
    ).toBe("2026-11-14");
    // The day is `yyyy-MM-dd`, the month and the day of the month with two digits: 0:20 on 5 March in Prague.
    expect(
      transactionDay({
        date: "2026-03-04",
        seenAt: "2026-03-04T23:20:00+00:00",
      }),
    ).toBe("2026-03-05");
  });

  inTimeZone("America/Los_Angeles", () => {
    // 15:20 on 14 November in Los Angeles (UTC−8).
    expect(transactionDay(transferFromDad)).toBe("2026-11-14");
  });
});
