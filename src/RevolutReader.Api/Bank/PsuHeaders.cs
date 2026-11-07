namespace RevolutReader.Api.Bank;

/// <summary>The user headers a read sends to the bank (c004 design.md D2): a fixed set, decided by who triggers the read.</summary>
public static class PsuHeaders {
  private const string IP_ADDRESS = "Psu-Ip-Address";
  private const string USER_AGENT = "Psu-User-Agent";

  /// <summary>
  /// Psu-Ip-Address and Psu-User-Agent for a present user; none for an unattended read (ADR-0001: never on background
  /// work). The address goes as <see cref="System.Net.IPAddress.ToString"/> writes it, an IPv4-mapped IPv6 one too:
  /// normalising forwarded addresses is the caller's (C7). No default: an empty <see cref="ReadTrigger"/> throws.
  /// </summary>
  public static IReadOnlyList<KeyValuePair<string, string>> For(ReadTrigger trigger) => trigger switch {
    PresentUser user => [new(IP_ADDRESS, user.IpAddress.ToString()), new(USER_AGENT, user.UserAgent)],
    Unattended => [],
  };
}