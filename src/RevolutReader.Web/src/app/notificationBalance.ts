// The balance in a notification's address (c019 design.md D2, D3, D5), shared by the page and the service worker: its
// only import is ./balanceRecord (c015 design.md D5), so the service worker never loads the API client.
import type { Balance } from "./balanceRecord";

/** Whether `address`'s fragment is a balance's (`#balance=…`), whatever its code: the page removes such a fragment. */
export function carriesBalance(address: string): boolean {
  void address;
  throw new Error("Not implemented: carriesBalance (c019 design.md D2)");
}

/**
 * The balance in `address`'s fragment when its code verifies under `secret` (D3) and `balanceOf` accepts its shape;
 * else null. Never rejects.
 */
export function balanceInAddress(
  address: string,
  secret: ArrayBuffer | null,
): Promise<Balance | null> {
  void address;
  void secret;
  throw new Error("Not implemented: balanceInAddress (c019 design.md D3)");
}
