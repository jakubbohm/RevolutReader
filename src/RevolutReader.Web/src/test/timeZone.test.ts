import { expect, test } from "vitest";
import { inTimeZoneWhile } from "./timeZone";

/** The zone the phone is set to now, as every `Intl` object made now takes it. */
function zoneNow(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 2026-11-14 23:20:00 UTC: 0:20 on the 15th in Prague, 15:20 on the 14th in Los Angeles. */
const AFTER_MIDNIGHT_IN_PRAGUE = Date.UTC(2026, 10, 14, 23, 20);

// Los Angeles is neither UTC (CI) nor Prague (the owner's machine), so the zone is seen to change wherever the tests run.
test("inTimeZoneWhile keeps the zone across the body's awaits", async () => {
  await inTimeZoneWhile("America/Los_Angeles", async () => {
    expect(zoneNow()).toBe("America/Los_Angeles");
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(zoneNow()).toBe("America/Los_Angeles");
    const seen = new Date(AFTER_MIDNIGHT_IN_PRAGUE);
    expect([seen.getDate(), seen.getHours(), seen.getMinutes()]).toEqual([
      14, 15, 20,
    ]);
  });
});

test("inTimeZoneWhile sets the phone to Prague time", async () => {
  await inTimeZoneWhile("Europe/Prague", async () => {
    await Promise.resolve();

    const seen = new Date(AFTER_MIDNIGHT_IN_PRAGUE);
    expect([seen.getDate(), seen.getHours(), seen.getMinutes()]).toEqual([
      15, 0, 20,
    ]);
  });
});

test("inTimeZoneWhile sets the zone back once the body has settled", async () => {
  const before = zoneNow();

  await inTimeZoneWhile("America/Los_Angeles", async () => {
    await Promise.resolve();
    expect(zoneNow()).toBe("America/Los_Angeles");
  });

  expect(zoneNow()).toBe(before);
  expect(new Date(AFTER_MIDNIGHT_IN_PRAGUE).toISOString()).toBe(
    "2026-11-14T23:20:00.000Z",
  );
});

test("inTimeZoneWhile sets the zone back and passes the rejection on when the body fails", async () => {
  const before = zoneNow();
  const failure = new Error("the body failed");

  await expect(
    inTimeZoneWhile("America/Los_Angeles", async () => {
      await Promise.resolve();
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(zoneNow()).toBe(before);
});
