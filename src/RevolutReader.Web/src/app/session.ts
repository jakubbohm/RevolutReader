/** Who the server says is signed in, as the page picks its screen from it (c007 design.md D3, D5). */
export type Session =
  | { kind: "unknown" }
  | { kind: "signed-out"; justSignedOut: boolean }
  | { kind: "refused"; email: string | null }
  | { kind: "signed-in"; name: string; email: string };

/** GET /api/me → 401 / 403 (+ email) / 200. */
export function readSession(): Promise<Session> {
  throw new Error("Not implemented");
}
