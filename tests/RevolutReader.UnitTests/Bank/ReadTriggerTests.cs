using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// A present user is checked when created (spec bank-reads, "Who triggers a read": a present user has an IP address and a
/// non-blank user agent; c006 design.md D1 g, § Public API sketch, § Error model): no address is an
/// <see cref="ArgumentNullException"/>, a null, empty or whitespace user agent an <see cref="ArgumentException"/> (a null
/// one may come as its subclass <see cref="ArgumentNullException"/>). The user agent is kept as given; it is cleaned only
/// when the header is built (D5). The address is a documentation address (RFC 5737), the browsers are made up.
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
}