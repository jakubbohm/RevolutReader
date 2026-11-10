using System.Diagnostics.CodeAnalysis;

namespace RevolutReader.Api.Push;

/// <summary>
/// A known push service's origin pattern (c011 design.md D9), as <c>Push:Services</c> names it: https and a host, or
/// https, "*." and a host suffix, with an optional port and no user information, path (beyond the root), query or
/// fragment; plain http only on a loopback host, the tests' fake (as the bank's address allows). The address parser takes
/// no "*" in a host, so a wildcard anywhere but at the start fails to parse. <see cref="KnownPushServices"/> matches push
/// addresses against it.
/// </summary>
public sealed class PushServicePattern {
  /// <summary>A wildcard pattern's start: the host suffix follows.</summary>
  private const string WILDCARD_START = "https://*.";

  private readonly string _scheme;
  private readonly int _port;

  /// <summary>The host an address must have; for a wildcard, the end its host must have: "." and the suffix.</summary>
  private readonly string _host;

  private readonly bool _wildcard;

  private PushServicePattern(Uri origin, bool wildcard) {
    _scheme = origin.Scheme;
    _port = origin.Port;
    _host = wildcard ? $".{origin.IdnHost}" : origin.IdnHost;
    _wildcard = wildcard;
  }

  /// <summary>The pattern <paramref name="text"/> holds, when it is one as the class describes; otherwise false.</summary>
  public static bool TryParse(string? text, [NotNullWhen(true)] out PushServicePattern? pattern) {
    pattern = null;

    if (string.IsNullOrEmpty(text))
      return false;

    bool wildcard = text.StartsWith(WILDCARD_START, StringComparison.OrdinalIgnoreCase);
    string originText = wildcard ? string.Concat(Uri.UriSchemeHttps, Uri.SchemeDelimiter, text.AsSpan(WILDCARD_START.Length)) : text;

    if (!Uri.TryCreate(originText, UriKind.Absolute, out Uri? origin) || !IsOrigin(origin, wildcard))
      return false;

    pattern = new PushServicePattern(origin, wildcard);

    return true;
  }

  /// <summary>
  /// Whether <paramref name="address"/> lies at this service: its scheme and port are the pattern's, and its host is the
  /// pattern's host or, for a wildcard, ends in "." and the suffix, so <c>push.apple.com.example.com</c> and
  /// <c>evilpush.apple.com</c> never lie under <c>*.push.apple.com</c>, nor does the bare suffix itself.
  /// </summary>
  public bool Matches(Uri address) {
    ArgumentNullException.ThrowIfNull(address);

    return address.IsAbsoluteUri
      && string.Equals(address.Scheme, _scheme, StringComparison.OrdinalIgnoreCase)
      && address.Port == _port
      && (_wildcard
        ? address.IdnHost.EndsWith(_host, StringComparison.OrdinalIgnoreCase)
        : string.Equals(address.IdnHost, _host, StringComparison.OrdinalIgnoreCase));
  }

  /// <summary>Whether <paramref name="origin"/> (a wildcard's with its suffix as the host) is an origin the class allows.</summary>
  private static bool IsOrigin(Uri origin, bool wildcard) =>
    origin.UserInfo.Length == 0
    && origin.AbsolutePath == "/"
    && origin.Query.Length == 0
    && origin.Fragment.Length == 0
    && (origin.Scheme == Uri.UriSchemeHttps
      ? !wildcard || origin.HostNameType == UriHostNameType.Dns
      : origin.Scheme == Uri.UriSchemeHttp && origin.IsLoopback);
}