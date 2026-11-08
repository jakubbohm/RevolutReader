import { api, wasAnswered } from "../api/client";

/** Who the server says is signed in, as the page picks its screen from it (c007 design.md D3, D5; c009 D2, D5). */
export type Session =
  | { kind: "signed-out"; justSignedOut: boolean }
  | { kind: "refused"; email: string | null }
  | { kind: "signed-in"; name: string; email: string }
  /** Any other answer: an error status, a plain-text hosting page, or a success that is not a session. */
  | { kind: "unexpected" }
  /** The phone says it is offline (nothing sent), or no answer came. */
  | { kind: "offline" };

const UNEXPECTED: Session = { kind: "unexpected" };

/**
 * Asks the server who is signed in (`GET /api/me`, c007 design.md D3; c009 D2, D5); never throws.
 * - The phone says it is offline: nothing is sent, and the session is offline.
 * - 200 with a name and an email: signed in; any other 200 body is unexpected.
 * - 401: signed out; 403: refused, with the email its problem description names (the contract's refused problem), or
 *   none.
 * - No answer (the request failed): offline. An answer with an error status never is: any other status, a plain-text
 *   hosting page among them, is unexpected.
 */
export async function readSession(): Promise<Session> {
  if (!navigator.onLine) return { kind: "offline" };

  // Only the request itself: a failure here is no answer, or a success that is not JSON. What the answer means is read
  // below, outside, so a bug there is never mistaken for offline.
  let answer;
  try {
    answer = await api.GET("/api/me");
  } catch (failure) {
    return wasAnswered(failure) ? UNEXPECTED : { kind: "offline" };
  }

  const { data, error, response } = answer;
  if (response.status === 200) return signedInOf(data) ?? UNEXPECTED;
  if (response.status === 401)
    return { kind: "signed-out", justSignedOut: false };
  if (response.status === 403)
    return { kind: "refused", email: emailOfRefusal(error) };

  return UNEXPECTED;
}

/**
 * The refused account's email, the 403 problem's `email` extension (c007 design.md D3), for any API address that
 * refuses; `null` when the body names none.
 */
export function emailOfRefusal(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("email" in body))
    return null;
  return typeof body.email === "string" ? body.email : null;
}

/** Signed in, when the body names the user: a name and an email, as text. */
function signedInOf(body: unknown): Session | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("name" in body && "email" in body)) return null;

  const { name, email } = body;
  return typeof name === "string" && typeof email === "string"
    ? { kind: "signed-in", name, email }
    : null;
}

/**
 * A sign-out that failed (c009 design.md D6): `offline` when the phone was offline or no answer came, otherwise the
 * server answered with an error.
 */
export class SignOutFailed extends Error {
  readonly offline: boolean;

  constructor(offline: boolean) {
    super(
      offline
        ? "The sign-out got no answer: the phone is offline."
        : "The server answered the sign-out with an error.",
    );
    this.name = "SignOutFailed";
    this.offline = offline;
  }
}

/**
 * Ends the login on this device (`POST /api/auth/logout`, c007 design.md D2); the Microsoft account stays signed in.
 * Resolves once the server has answered with success. Rejects with `SignOutFailed` otherwise, so the caller decides
 * what that means for its screen (c009 D2, D6): offline when the phone says so (nothing is sent) or no answer came; not
 * offline when the server answered with an error, a plain-text hosting page among them.
 */
export async function signOut(): Promise<void> {
  if (!navigator.onLine) throw new SignOutFailed(true);

  let response: Response;
  try {
    ({ response } = await api.POST("/api/auth/logout"));
  } catch (failure) {
    throw new SignOutFailed(!wasAnswered(failure));
  }

  if (!response.ok) throw new SignOutFailed(false);
}

/** The backend's sign-in address (design.md D2), and its query for Microsoft's account picker. */
const SIGN_IN = "/api/auth/login";
const ANOTHER_ACCOUNT = "?anotherAccount=true";

/**
 * Starts a sign-in: the page goes to the backend's sign-in address, which sends it on to Microsoft (design.md D2, D9).
 * A navigation, never a fetch, because Microsoft's pages must open in the page itself. With `anotherAccount`, Microsoft
 * is asked for its account picker ("Zkusit jiný účet").
 */
export function startSignIn(options?: { anotherAccount?: boolean }): void {
  location.assign(
    options?.anotherAccount === true ? `${SIGN_IN}${ANOTHER_ACCOUNT}` : SIGN_IN,
  );
}
