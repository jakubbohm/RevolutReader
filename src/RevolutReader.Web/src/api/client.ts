import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * The app's one API client (c007 design.md D9), typed from the API's OpenAPI document. It calls the page's own origin,
 * which serves the API under `/api`: in production the same server, locally Vite, which forwards `/api` to the API.
 */
export const api = createClient<paths>({ baseUrl: window.location.origin });

/**
 * Whether a request the client rejected still got an answer (c009 design.md D2, D5): the client rejects with a
 * `SyntaxError` when a success's body is not JSON (a public Wi-Fi's login page, say), which is an answer, only not the
 * one expected; every other rejection means none came: the request failed, broke off, or was aborted.
 */
export function wasAnswered(failure: unknown): boolean {
  return failure instanceof SyntaxError;
}

/** What a read of the API came to, as every read sees it before its own answer is read (`askTheApi`). */
export type ApiAnswer =
  /** The phone says it is offline (nothing sent), or no answer came. */
  | { kind: "offline" }
  /** A success whose body is not JSON. */
  | { kind: "unexpected" }
  /** 401: nobody is signed in. */
  | { kind: "signed out" }
  /** 403: the signed-in account is refused, with the email its problem names, or none. */
  | { kind: "refused"; email: string | null }
  /** Any other answer, for the read to tell what it means: its status, and its body as the client parsed it. */
  | { kind: "answer"; status: number; data: unknown; error: unknown };

/**
 * The steps every read of the API shares (c009 design.md D2, D5); never throws. The phone says it is offline: nothing is
 * sent. Only the request itself sits inside the `try`, so a bug in reading the answer is never mistaken for offline: a
 * rejected request is no answer (offline), or a success that is not JSON (unexpected). 401 and 403 mean the same for
 * every read; any other answer goes back to the read, whose own rules tell what it means.
 */
export async function askTheApi(
  request: () => Promise<{
    data?: unknown;
    error?: unknown;
    response: Response;
  }>,
): Promise<ApiAnswer> {
  if (!navigator.onLine) return { kind: "offline" };

  let answer;
  try {
    answer = await request();
  } catch (failure) {
    return wasAnswered(failure) ? { kind: "unexpected" } : { kind: "offline" };
  }

  const { data, error, response } = answer;
  if (response.status === 401) return { kind: "signed out" };
  if (response.status === 403)
    return { kind: "refused", email: emailOfRefusal(error) };

  return { kind: "answer", status: response.status, data, error };
}

/** The refused account's email, the 403 problem's `email` extension (c007 design.md D3); `null` when the body names none. */
function emailOfRefusal(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("email" in body))
    return null;
  return typeof body.email === "string" ? body.email : null;
}
