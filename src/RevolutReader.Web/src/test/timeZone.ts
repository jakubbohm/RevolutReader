/** The test process's environment variables (Node's `process.env`; the app's types know no Node). */
const environment = (
  globalThis as unknown as {
    process: { env: Record<string, string | undefined> };
  }
).process.env;

/**
 * Runs `body` as on a phone set to the time zone `zone` (an IANA name, e.g. `America/Los_Angeles`), then sets the zone
 * back (c010, for rules that must hold "whatever the time zone"). Node applies a change to `TZ` at once, to `Date` and
 * to every `Intl` object made after it; deleting the variable applies nothing, so the zone is first set back by name.
 * Make the test's dates inside `body`: a `Date` made outside it stands for a moment, not for a wall-clock time there.
 */
export function inTimeZone(zone: string, body: () => void): void {
  const variableBefore = environment.TZ;
  const zoneBefore = Intl.DateTimeFormat().resolvedOptions().timeZone;
  environment.TZ = zone;
  try {
    body();
  } finally {
    environment.TZ = variableBefore ?? zoneBefore;
    if (variableBefore === undefined) delete environment.TZ;
  }
}
