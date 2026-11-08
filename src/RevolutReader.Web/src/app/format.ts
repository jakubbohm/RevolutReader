// Czech formats for the balance header (c009 design.md D10), translated from the design system's format.ts.
// Stubs until c009 tasks.md group 14 is implemented; `void` keeps the unused-parameter check quiet until then.

/** An amount in euros, as `286,40 €`. */
export function formatEur(amount: number): string {
  void amount;
  throw new Error("not implemented");
}

/** The amount's koruna value, rounded to whole crowns, its size only, as `≈ 6 960 Kč`. */
export function formatCzkApprox(eurAmount: number, rate: number): string {
  void eurAmount;
  void rate;
  throw new Error("not implemented");
}

/** The koruna value as a screen reader says it, as `přibližně 6 960 Kč`. */
export function czkApproxLabel(eurAmount: number, rate: number): string {
  void eurAmount;
  void rate;
  throw new Error("not implemented");
}

/** When the server read the balance, as the freshness line says it: `Aktualizováno před 2 min`, … */
export function formatUpdated(readAt: Date, now: Date): string {
  void readAt;
  void now;
  throw new Error("not implemented");
}
