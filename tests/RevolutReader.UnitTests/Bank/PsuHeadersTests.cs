using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// Who triggers a read decides the user headers (spec bank-reads, "Who triggers a read"; c004 design.md D2): a present
/// user's real IP address and browser as <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>, exactly those two; an
/// unattended read none at all (ADR-0001: never on background work). Header names are compared as HTTP compares them,
/// ignoring case; values exactly. The addresses are documentation addresses (RFC 5737, RFC 3849).
/// </summary>
public sealed class PsuHeadersTests {
  private const string IPHONE_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)";

  /// <param name="ipAddress">The user's address as the bank must receive it: IPv4, or IPv6 in its usual short form.</param>
  [Test]
  [Arguments("203.0.113.7")]
  [Arguments("2001:db8::7")]
  public void A_present_user_gives_exactly_the_IP_address_and_user_agent_headers(string ipAddress) {
    IReadOnlyList<KeyValuePair<string, string>> headers = PsuHeaders.For(new PresentUser(IPAddress.Parse(ipAddress), IPHONE_BROWSER));

    Named(headers).ShouldBe([("PSU-IP-ADDRESS", ipAddress), ("PSU-USER-AGENT", IPHONE_BROWSER)], ignoreOrder: true);
  }

  [Test]
  public void An_unattended_read_gives_no_user_headers() =>
    PsuHeaders.For(new Unattended()).ShouldBeEmpty();

  /// <summary>Each header as (name, value), the name in upper case: HTTP header names ignore case.</summary>
  private static IReadOnlyList<(string Name, string Value)> Named(IReadOnlyList<KeyValuePair<string, string>> headers) =>
    [.. headers.Select(static header => (header.Key.ToUpperInvariant(), header.Value))];
}