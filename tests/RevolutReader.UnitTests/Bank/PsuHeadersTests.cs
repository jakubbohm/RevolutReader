using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// Who triggers a read decides the user headers (spec bank-reads, "Who triggers a read"; c004 design.md D2): a present
/// user's real IP address and browser as <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>, exactly those two; an
/// unattended read none at all (ADR-0001: never on background work). Each character of the user agent outside printable
/// ASCII (0x20 to 0x7E) is sent as <c>?</c>, one for one, so the length stays the same (c006 design.md D5). Header names
/// are compared as HTTP compares them, ignoring case; values exactly. The addresses are documentation addresses (RFC 5737,
/// RFC 3849); the browsers are made up.
/// </summary>
public sealed class PsuHeadersTests {
  private const string IPHONE_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)";

  private static readonly IPAddress _documentationAddress = IPAddress.Parse("203.0.113.7");

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

  /// <param name="userAgent">A browser name with accented letters (each one character, precomposed).</param>
  /// <param name="sent">The same name with each accented letter as a question mark.</param>
  [Test]
  [Arguments("Mozilla/5.0 (café)", "Mozilla/5.0 (caf?)")]
  [Arguments("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) ?te?ka/1.0")]
  public void An_accented_letter_in_the_user_agent_is_sent_as_a_question_mark_and_the_length_stays_the_same(string userAgent, string sent) {
    ArgumentNullException.ThrowIfNull(userAgent);

    string userAgentSent = UserAgentSent(userAgent);

    userAgentSent.ShouldBe(sent);
    userAgentSent.Length.ShouldBe(userAgent.Length);
  }

  /// <param name="control">The control character's code: 0x01, a tab (0x09), DEL (0x7F). Passed as a number, so the test's name stays printable.</param>
  [Test]
  [Arguments(0x01)]
  [Arguments(0x09)]
  [Arguments(0x7F)]
  public void A_control_character_in_the_user_agent_is_sent_as_a_question_mark(int control) =>
    UserAgentSent($"Mozilla/5.0 (X11{(char)control}Linux x86_64)").ShouldBe("Mozilla/5.0 (X11?Linux x86_64)");

  /// <param name="character">The character's code: a carriage return (0x0D), a line feed (0x0A), NUL (0x00). Passed as a number, so the test's name stays printable.</param>
  [Test]
  [Arguments(0x0D)]
  [Arguments(0x0A)]
  [Arguments(0x00)]
  public void A_line_break_or_a_NUL_in_the_user_agent_is_sent_as_a_question_mark(int character) =>
    UserAgentSent($"Mozilla/5.0 (X11{(char)character}Linux x86_64)").ShouldBe("Mozilla/5.0 (X11?Linux x86_64)");

  /// <summary>Every printable ASCII character, from the space (0x20) to the tilde (0x7E), in one user agent.</summary>
  [Test]
  public void A_user_agent_of_printable_ASCII_is_sent_unchanged() {
    string everyPrintableCharacter = new([.. Enumerable.Range(0x20, 0x7E - 0x20 + 1).Select(static code => (char)code)]);

    UserAgentSent(everyPrintableCharacter).ShouldBe(everyPrintableCharacter);
  }

  /// <summary>The <c>Psu-User-Agent</c> header's value for a present user with this user agent (name compared ignoring case).</summary>
  private static string UserAgentSent(string userAgent) =>
    PsuHeaders.For(new PresentUser(_documentationAddress, userAgent))
      .Single(static header => header.Key.Equals("Psu-User-Agent", StringComparison.OrdinalIgnoreCase))
      .Value;

  /// <summary>Each header as (name, value), the name in upper case: HTTP header names ignore case.</summary>
  private static IReadOnlyList<(string Name, string Value)> Named(IReadOnlyList<KeyValuePair<string, string>> headers) =>
    [.. headers.Select(static header => (header.Key.ToUpperInvariant(), header.Value))];
}