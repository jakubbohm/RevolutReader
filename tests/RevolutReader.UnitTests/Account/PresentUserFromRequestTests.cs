using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The present user is read from the request a signed-in user's open or refresh sent (the user, 2026-11-08, roadmap C13):
/// the client address as the forwarded headers left it on the connection (c007 design.md D10) and the
/// <c>User-Agent</c> header as ASP.NET reads it. Turning an IPv4 address in IPv6 form into plain IPv4 is the present
/// user's own (<c>ReadTriggerTests</c>). The browser name is kept as given, a header sent on two lines as both values
/// joined with a comma: cleaning it is the bank header's job (c006 design.md D5). No client address, or a missing, empty
/// or whitespace <c>User-Agent</c>, gives no present user (<see langword="null"/>): the endpoint then answers 400 and
/// never reads unattended in its place, which would count against the bank's 4 reads a day without the user (ADR-0001).
/// The address is a documentation address (RFC 5737); the browsers are made up.
/// </summary>
public sealed class PresentUserFromRequestTests {
  private const string IPHONE_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)";

  private static readonly IPAddress _documentationAddress = IPAddress.Parse("203.0.113.7");

  /// <param name="userAgent">
  /// A plain browser name, and one with accented letters, which stay accented here: the question marks belong to the bank
  /// header (c006 design.md D5), not to the user.
  /// </param>
  [Test]
  [Arguments(IPHONE_BROWSER)]
  [Arguments("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Čtečka/1.0")]
  public void The_client_address_and_the_browser_name_are_taken_as_given(string userAgent) {
    PresentUser? user = PresentUserFromRequest.Read(Request(IPAddress.Parse("203.0.113.7"), userAgent));

    user.ShouldNotBeNull();
    user.IpAddress.ShouldBe(_documentationAddress);
    user.UserAgent.ShouldBe(userAgent);
  }

  [Test]
  public void No_client_address_gives_no_present_user() =>
    PresentUserFromRequest.Read(Request(address: null, IPHONE_BROWSER)).ShouldBeNull();

  [Test]
  public void A_missing_User_Agent_gives_no_present_user() =>
    PresentUserFromRequest.Read(Request(_documentationAddress, StringValues.Empty)).ShouldBeNull();

  /// <param name="userAgent">The header sent with an empty value, or with nothing but white space (spaces, a tab).</param>
  [Test]
  [Arguments("")]
  [Arguments(" ")]
  [Arguments("   ")]
  [Arguments("\t")]
  [Arguments(" \t ")]
  public void An_empty_or_whitespace_User_Agent_gives_no_present_user(string userAgent) =>
    PresentUserFromRequest.Read(Request(_documentationAddress, userAgent)).ShouldBeNull();

  /// <summary>As ASP.NET reads a header sent on two lines: both values, joined by a comma with no space after it.</summary>
  [Test]
  public void A_User_Agent_sent_on_two_lines_gives_one_browser_name_with_both_values_joined_by_a_comma() {
    PresentUser? user = PresentUserFromRequest.Read(Request(_documentationAddress, new StringValues([IPHONE_BROWSER, "Ctecka/1.0"])));

    user.ShouldNotBeNull();
    user.UserAgent.ShouldBe("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X),Ctecka/1.0");
  }

  /// <summary>
  /// Two lines of nothing but white space are as blank as one: ASP.NET reads them as a comma between blanks (<c>" , "</c>),
  /// which is not blank itself, so the browser name would be a lone comma.
  /// </summary>
  /// <param name="first">The first line: spaces or a tab.</param>
  /// <param name="second">The second line: spaces or a tab.</param>
  [Test]
  [Arguments(" ", " ")]
  [Arguments("\t", "   ")]
  public void A_User_Agent_sent_on_two_whitespace_lines_gives_no_present_user(string first, string second) =>
    PresentUserFromRequest.Read(Request(_documentationAddress, new StringValues([first, second]))).ShouldBeNull();

  [Test]
  public void A_null_context_is_rejected() {
    ArgumentNullException error = Should.Throw<ArgumentNullException>(() => PresentUserFromRequest.Read(null!));

    error.ParamName.ShouldBe("context");
  }

  /// <summary>
  /// A request as the app sees it after the forwarded headers: from <paramref name="address"/> (<see langword="null"/>: no
  /// client address), with these <c>User-Agent</c> values, one per line the header was sent on (none: not sent).
  /// </summary>
  private static DefaultHttpContext Request(IPAddress? address, StringValues userAgent) {
    DefaultHttpContext context = new();
    context.Connection.RemoteIpAddress = address;
    if (userAgent.Count > 0)
      context.Request.Headers.UserAgent = userAgent;

    return context;
  }
}