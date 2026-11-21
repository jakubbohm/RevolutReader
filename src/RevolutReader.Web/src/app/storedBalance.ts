import { createStore, del, get, set, update } from "idb-keyval";
// Not "./balance", which loads the API client: the service worker imports this module and has no `window` (c015
// design.md D5).
import { balanceOf, type Balance } from "./balanceRecord";

// The balance the phone keeps (c009 design.md D4; ADR-0007): one record `{ amount, readAt, czkPerEur }` in the app's
// own IndexedDB database and store, so the service worker can write it too (C9, c015 design.md D3). No owner and no
// expiry: every allowed user sees the same account, and the freshness line dates it. The storage is a convenience: a
// failing store reads as none, and a failed write or delete is ignored, whether it rejects or throws at once
// (idb-keyval throws when it cannot even open the database).

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

/**
 * Keeps a balance a push brought in place of the one the phone keeps (c015 design.md D3): only when the phone keeps a
 * balance of the right shape and the pushed one was not read earlier (`readAt` compared as moments); read, compared and
 * written in one IndexedDB transaction (idb-keyval's `update`), only the three fields. Never rejects: a failure is ignored.
 */
export async function keepPushedBalance(pushed: Balance): Promise<void> {
  const { amount, readAt, czkPerEur } = pushed;
  try {
    // The get and the put share one readwrite transaction, so the page's own write after a read, or its delete when a
    // login ends, never falls between the compare and the write. Not replacing puts back what was there: for a phone
    // that keeps nothing that is `undefined`, which reads as nothing kept.
    await update<unknown>(
      LAST,
      (record) =>
        replacesKept(readAt, record) ? { amount, readAt, czkPerEur } : record,
      phone,
    );
  } catch {
    // Nothing kept from this push: the next read of the balance keeps a newer one.
  }
}

/**
 * Whether a push's balance read at `readAt` replaces this kept record (c015 design.md D3): only a balance of the right
 * shape is replaced, never none (a push only replaces), and only when the push's was not read earlier, the two times
 * compared as moments, so two offsets for the same moment are equal.
 */
function replacesKept(readAt: string, record: unknown): boolean {
  const kept = balanceOf(record);
  if (kept === null) return false;
  return Date.parse(readAt) >= Date.parse(kept.readAt);
}

/** Forgets the kept balance; a failure is ignored. */
export async function forgetStoredBalance(): Promise<void> {
  try {
    await del(LAST, phone);
  } catch {
    // Nothing more can be done from here; a device without a login stores nothing new.
  }
}
