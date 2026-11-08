using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Security;

/// <summary>
/// The rule against writes from other sites (c007 design.md D4), pure, so every row of its table is a unit test. The
/// hosting domain is not on the Public Suffix List, so every other app on it counts as the same site, and SameSite cookies
/// alone would not stop its pages from making the visitor's browser send a write with the login cookie.
/// </summary>
public static class CrossSiteWrites {
  /// <summary>The <c>Sec-Fetch-Site</c> values of a request the app's own page made, or the user started directly.</summary>
  private const string SAME_ORIGIN = "same-origin";
  private const string NONE = "none";

  /// <summary>Every address of the API: the rule guards writes there only.</summary>
  private static readonly PathString _api = new("/api");

  /// <summary>
  /// Whether a request may go on. A write (POST, PUT, PATCH or DELETE, in any letter case) to a path under <c>/api</c> (by
  /// segment, ignoring case) is allowed when:
  /// <list type="bullet">
  /// <item>it is the sign-in return <see cref="SignInAddresses.CALLBACK"/> itself (ignoring case), which Microsoft's page
  /// posts cross-site by design and the handler's state, correlation cookie, nonce and PKCE protect;</item>
  /// <item>otherwise, when <paramref name="secFetchSite"/> is present: it is exactly <c>same-origin</c> or <c>none</c>;</item>
  /// <item>otherwise, when <paramref name="origin"/> is present: it is exactly <paramref name="requestOrigin"/>, the
  /// request's own scheme and host (after the forwarded headers);</item>
  /// <item>otherwise, with neither header: always, because it is not a browser's request, and such callers don't get the
  /// login cookie by themselves.</item>
  /// </list>
  /// Every other request is allowed.
  /// </summary>
  public static bool IsAllowed(string method, PathString path, string? secFetchSite, string? origin, string requestOrigin) {
    ArgumentNullException.ThrowIfNull(method);
    ArgumentNullException.ThrowIfNull(requestOrigin);

    if (!IsWrite(method) || !path.StartsWithSegments(_api, StringComparison.OrdinalIgnoreCase))
      return true;

    if (path.Equals(SignInAddresses.CALLBACK, StringComparison.OrdinalIgnoreCase))
      return true;

    if (secFetchSite is not null)
      return secFetchSite is SAME_ORIGIN or NONE;

    if (origin is not null)
      return string.Equals(origin, requestOrigin, StringComparison.Ordinal);

    return true;
  }

  private static bool IsWrite(string method) => HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
}