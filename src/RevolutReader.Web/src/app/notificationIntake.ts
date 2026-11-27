// The page's intake of notifications' balances (c019 design.md D5, D6): from its own address and from the notifications
// the phone still shows, kept by c015's rule.

/** What one intake came to. */
export interface IntakeOutcome {
  /** A balance was kept in place of the one before. */
  kept: boolean;
}

/**
 * Takes in the newest valid balance of the page's own address (`fromAddress`) and of every listed notification's
 * `navigate` (`fromList`), kept by `keepNotificationBalance`; removes a balance fragment from the page's address. Never
 * rejects: every browser call that fails means no balance from it.
 */
export function takeInNotificationBalances(options: {
  fromAddress: boolean;
  fromList: boolean;
  browser?: Window;
}): Promise<IntakeOutcome> {
  void options;
  throw new Error(
    "Not implemented: takeInNotificationBalances (c019 design.md D5, D6)",
  );
}
