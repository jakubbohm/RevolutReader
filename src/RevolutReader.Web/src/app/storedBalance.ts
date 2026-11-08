import { createStore, del, get, set } from "idb-keyval";
import { balanceOf, type Balance } from "./balance";

// The balance the phone keeps (c009 design.md D4; ADR-0007): one record `{ amount, readAt, czkPerEur }` in the app's
// own IndexedDB database and store, so the service worker can write it too (C9). No owner and no expiry: every allowed
// user sees the same account, and the freshness line dates it. The storage is a convenience: a failing store reads as
// none, and a failed write or delete is ignored, whether it rejects or throws at once (idb-keyval throws when it cannot
// even open the database).

/** The app's database and its store for the balance. Opened on first use, and kept open by idb-keyval. */
const phone = createStore("tarjeta-papa", "balance");

/** The one record's key. */
const LAST = "last";

/** The kept balance; `null` when there is none, it has the wrong shape (the API answer's), or the store fails. */
export async function loadStoredBalance(): Promise<Balance | null> {
  try {
    return balanceOf(await get<unknown>(LAST, phone));
  } catch {
    return null;
  }
}

/** Keeps this balance in place of the one before, only its three fields; a failure is ignored. */
export async function storeBalance(balance: Balance): Promise<void> {
  const { amount, readAt, czkPerEur } = balance;
  try {
    await set(LAST, { amount, readAt, czkPerEur }, phone);
  } catch {
    // Nothing kept this time: the next read tries again.
  }
}

/** Forgets the kept balance; a failure is ignored. */
export async function forgetStoredBalance(): Promise<void> {
  try {
    await del(LAST, phone);
  } catch {
    // Nothing more can be done from here; a device without a login stores nothing new.
  }
}
