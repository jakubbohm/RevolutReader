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
  const setBack = setTimeZone(zone);
  try {
    body();
  } finally {
    setBack();
  }
}

/**
 * As `inTimeZone`, for an async body (c018 design.md D10): the zone is set back once the body's promise settles,
 * fulfilled or rejected, and the rejection passes on. For a scenario that renders the app and waits on the test clock in
 * the zone, e.g. a phone set to Prague time. Make the test's dates inside `body`, as for `inTimeZone`.
 */
export async function inTimeZoneWhile(
  zone: string,
  body: () => Promise<void>,
): Promise<void> {
  const setBack = setTimeZone(zone);
  try {
    await body();
  } finally {
    setBack();
  }
}

/** Sets the time zone to `zone` and answers how to set it back as it was. */
function setTimeZone(zone: string): () => void {
  const variableBefore = environment.TZ;
  const zoneBefore = Intl.DateTimeFormat().resolvedOptions().timeZone;
  environment.TZ = zone;
  return () => {
    environment.TZ = variableBefore ?? zoneBefore;
    if (variableBefore === undefined) delete environment.TZ;
  };
}
