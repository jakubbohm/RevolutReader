namespace RevolutReader.Api.SignIn;

/// <summary>
/// Sign-in's cookie names (c007 design.md D4). The <c>__Host-</c> prefix makes the browser take such a cookie only from
/// the app's exact host, set Secure, with Path <c>/</c> and without a Domain, so no other app on the shared hosting domain
/// can plant one. Renaming the login cookie signs everyone out once.
/// </summary>
public static class SignInCookies {
  /// <summary>The login: HttpOnly, Secure, Path <c>/</c>, SameSite Lax, persistent, 30 days, sliding.</summary>
  public const string SESSION = "__Host-session";

  /// <summary>
  /// The OpenID Connect handler's correlation and nonce cookies during the round trip to Microsoft: HttpOnly, Secure,
  /// Path <c>/</c>, SameSite None, because Microsoft returns with a cross-site POST.
  /// </summary>
  public const string ROUND_TRIP_PREFIX = "__Host-signin-";
}