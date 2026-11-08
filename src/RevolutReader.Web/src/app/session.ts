import { api } from "../api/client";

/** Who the server says is signed in, as the page picks its screen from it (c007 design.md D3, D5). */
export type Session =
  | { kind: "unknown" }
  | { kind: "signed-out"; justSignedOut: boolean }
  | { kind: "refused"; email: string | null }
  | { kind: "signed-in"; name: string; email: string };

/**
 * Asks the server who is signed in (`GET /api/me`, design.md D3): 200 → signed in, with the name and email; 401 →
 * signed out; 403 → refused, with the email its problem description names (the contract's refused problem), or none.
 * Anything else, a server error or no answer at all (offline, the request failed), reads as unknown, so the page keeps
 * its empty frame (D5). Never throws.
 */
export async function readSession(): Promise<Session> {
  try {
    const { data, error, response } = await api.GET("/api/me");

    if (data !== undefined)
      return { kind: "signed-in", name: data.name, email: data.email };
    if (response.status === 401)
      return { kind: "signed-out", justSignedOut: false };
    if (response.status === 403)
      return {
        kind: "refused",
        email:
          error !== undefined && "email" in error
            ? (error.email ?? null)
            : null,
      };

    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

/** location → /api/auth/login[?anotherAccount=true] */
export function startSignIn(_options?: { anotherAccount?: boolean }): void {
  throw new Error("Not implemented");
}
