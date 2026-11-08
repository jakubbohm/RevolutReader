namespace RevolutReader.Api.Bank;

/// <summary>The user headers a read sends to the bank (c004 design.md D2): a fixed set, decided by who triggers the read.</summary>
public static class PsuHeaders {
  private const string IP_ADDRESS = "Psu-Ip-Address";
  private const string USER_AGENT = "Psu-User-Agent";

  /// <summary>The first and the last character a user agent is sent with as it is: printable ASCII, 0x20 to 0x7E.</summary>
  private const char FIRST_PRINTABLE = ' ';
  private const char LAST_PRINTABLE = '~';

  private const char REPLACEMENT = '?';

  /// <summary>
  /// Psu-Ip-Address and Psu-User-Agent for a present user; none for an unattended read (ADR-0001: never on background
  /// work). The address goes as <see cref="System.Net.IPAddress.ToString"/> writes it, an IPv4-mapped IPv6 one too:
  /// normalising forwarded addresses is the caller's (<see cref="Account.PresentUserFromRequest.Read"/>, C13). Each
  /// character of the user agent outside printable ASCII (0x20 to 0x7E) is sent as <c>?</c>, one for one, so the length
  /// stays the same (spec bank-reads § Who triggers a read; c006 design.md D5): <see cref="HttpClient"/> refuses
  /// non-ASCII header values, sends control characters raw and throws on a line break or a NUL.
  /// <see cref="PresentUser.UserAgent"/> stays as given. No default: an empty <see cref="ReadTrigger"/> throws.
  /// </summary>
  public static IReadOnlyList<KeyValuePair<string, string>> For(ReadTrigger trigger) => trigger switch {
    PresentUser user => [new(IP_ADDRESS, user.IpAddress.ToString()), new(USER_AGENT, Printable(user.UserAgent))],
    Unattended => [],
  };

  /// <summary>The user agent with each character outside printable ASCII as <c>?</c>; the same instance when it has none.</summary>
  private static string Printable(string userAgent) {
    int first = userAgent.AsSpan().IndexOfAnyExceptInRange(FIRST_PRINTABLE, LAST_PRINTABLE);
    if (first < 0)
      return userAgent;

    return string.Create(userAgent.Length, (userAgent, first), static (sent, state) => {
      state.userAgent.AsSpan().CopyTo(sent);
      foreach (ref char character in sent[state.first..])
        if (character is < FIRST_PRINTABLE or > LAST_PRINTABLE)
          character = REPLACEMENT;
    });
  }
}