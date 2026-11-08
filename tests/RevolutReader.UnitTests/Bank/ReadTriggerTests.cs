using System.Net;
using System.Net.Sockets;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// A present user is checked when created (spec bank-reads, "Who triggers a read": a present user has an IP address and a
/// non-blank user agent; c006 design.md D1 g, § Public API sketch, § Error model): no address is an
/// <see cref="ArgumentNullException"/>, a null, empty or whitespace user agent an <see cref="ArgumentException"/> (a null
/// one may come as its subclass <see cref="ArgumentNullException"/>). The user agent is kept as given; it is cleaned only
/// when the header is built (D5). An IPv4 address in IPv6 form becomes plain IPv4, whoever creates the present user (c004
/// design.md D2; the user, 2026-11-08, C13's code review); any other address, an IPv6 one too, is kept as it is. The
/// addresses are documentation addresses (RFC 5737, RFC 3849), the browsers are made up.
/// </summary>
public sealed class ReadTriggerTests {
  private const string IPHONE_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)";

  private static readonly IPAddress _documentationAddress = IPAddress.Parse("203.0.113.7");

  [Test]
  public void A_present_user_without_an_IP_address_is_rejected() {
    ArgumentNullException error = Should.Throw<ArgumentNullException>(() => new PresentUser(null!, IPHONE_BROWSER));

    error.ParamName.ShouldBe("ipAddress");
  }

  /// <param name="userAgent">Null, empty, or nothing but white space (a space, a tab, a line break).</param>
  [Test]
  [Arguments(null)]
  [Arguments("")]
  [Arguments(" ")]
  [Arguments("\t")]
  [Arguments(" \r\n ")]
  public void A_present_user_with_a_null_empty_or_whitespace_user_agent_is_rejected(string? userAgent) {
    ArgumentException error = Should.Throw<ArgumentException>(() => new PresentUser(_documentationAddress, userAgent!));

    error.ParamName.ShouldBe("userAgent");
  }

  /// <summary>An accented browser name stays accented here: the question marks belong to the header (D5), not to the user.</summary>
  [Test]
  public void A_present_user_keeps_the_IP_address_and_the_user_agent_as_given() {
    PresentUser user = new(IPAddress.Parse("203.0.113.7"), "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0");

    user.IpAddress.ShouldBe(_documentationAddress);
    user.UserAgent.ShouldBe("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0");
  }

  /// <summary>
  /// As a server listening on IPv6 can report an IPv4 visitor. The bank gets <c>203.0.113.7</c>, not
  /// <c>::ffff:203.0.113.7</c> (c004 design.md D2).
  /// </summary>
  [Test]
  public void A_present_users_IPv4_address_in_IPv6_form_becomes_plain_IPv4() {
    PresentUser user = new(IPAddress.Parse("::ffff:203.0.113.7"), IPHONE_BROWSER);

    user.IpAddress.ShouldBe(_documentationAddress);
    user.IpAddress.AddressFamily.ShouldBe(AddressFamily.InterNetwork);
  }

  /// <param name="address">
  /// An IPv6 address (RFC 3849), and the old IPv4-compatible form (RFC 4291 § 2.5.5.1), which is not the IPv4-mapped one
  /// and so is kept too.
  /// </param>
  [Test]
  [Arguments("2001:db8::7")]
  [Arguments("::203.0.113.7")]
  public void A_present_users_other_IPv6_address_is_kept_as_it_is(string address) {
    PresentUser user = new(IPAddress.Parse(address), IPHONE_BROWSER);

    user.IpAddress.ShouldBe(IPAddress.Parse(address));
  }
}