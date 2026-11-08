using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The sign-in's cookies carry the attributes of c007 design.md D4, read from the <c>Set-Cookie</c> headers the app sends:
/// <list type="bullet">
/// <item>starting a sign-in sets the handler's two round-trip cookies (correlation and nonce), named <c>__Host-signin-</c>…,
/// with Path <c>/</c>, Secure, HttpOnly, SameSite None (Microsoft returns with a cross-site POST), no Domain, kept at most
/// 15 minutes;</item>
/// <item>the return from Microsoft sets the login <c>__Host-session</c>, with Path <c>/</c>, Secure, HttpOnly, SameSite
/// Lax, no Domain, and persistent: kept 30 days from the app's clock now, also after the browser closes (ADR-0003).</item>
/// </list>
/// The <c>__Host-</c> prefix (D4) makes a browser take such a cookie only from the app's own host, Secure, with Path
/// <c>/</c> and without a Domain, so no other app on the shared hosting domain can plant one; the attributes are checked
/// here, because the test browser does not enforce the prefix. A lifetime may be off by a minute: a cookie's expiry is
/// written to the second, and the handler's clock may run a few seconds ahead of the app copy's. A rule, not a scenario.
/// </summary>
public sealed class SignInCookiesTests : AcceptanceTest {
  private const string ROUND_TRIP_PREFIX = "__Host-signin-";
  private const string LOGIN = "__Host-session";
  private const string WHOLE_APP = "/";

  private static readonly TimeSpan _tolerance = TimeSpan.FromMinutes(1);
  private static readonly TimeSpan _roundTripLifetime = TimeSpan.FromMinutes(15);
  private static readonly TimeSpan _loginLifetime = TimeSpan.FromDays(30);

  [Test]
  public async Task Starting_a_sign_in_sets_two_round_trip_cookies_host_only_Secure_HttpOnly_SameSite_None_kept_at_most_15_minutes() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");

    IReadOnlyList<CookieSet> cookies = SignInDriver.CookiesSetByTheStart();

    cookies.Select(static cookie => cookie.Name).ShouldAllBe(name => name.StartsWith(ROUND_TRIP_PREFIX, StringComparison.Ordinal), "Cookies set by the start");
    cookies.Count.ShouldBe(2, "the correlation and the nonce cookie");

    foreach (CookieSet cookie in cookies)
      cookie.ShouldSatisfyAllConditions(
        () => cookie.Path.ShouldBe(WHOLE_APP, $"{cookie.Name}: Path"),
        () => cookie.Domain.ShouldBeNull($"{cookie.Name}: no Domain"),
        () => cookie.Secure.ShouldBeTrue($"{cookie.Name}: Secure"),
        () => cookie.HttpOnly.ShouldBeTrue($"{cookie.Name}: HttpOnly"),
        () => cookie.SameSite.ShouldBe("None", $"{cookie.Name}: SameSite"),
        () => cookie.Lifetime.ShouldNotBeNull($"{cookie.Name}: an expiry"),
        () => cookie.Lifetime.GetValueOrDefault().ShouldBeGreaterThan(TimeSpan.Zero, $"{cookie.Name}: kept, not deleted"),
        () => cookie.Lifetime.GetValueOrDefault().ShouldBeLessThanOrEqualTo(_roundTripLifetime + _tolerance, $"{cookie.Name}: kept at most 15 minutes"));
  }

  [Test]
  public async Task The_return_from_Microsoft_sets_the_login_host_only_Secure_HttpOnly_SameSite_Lax_kept_30_days() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");
    (await SignIn.MicrosoftAnswersWith(Visitor.Lucie)).ShouldBe(Landing.StartPage, "Lucie signed in");

    CookieSet[] logins = [.. SignInDriver.CookiesSetByTheReturn().Where(static cookie => cookie.Name == LOGIN)];

    logins.Length.ShouldBe(1, $"one {LOGIN} cookie set by the return");
    CookieSet login = logins[0];

    login.ShouldSatisfyAllConditions(
      () => login.Path.ShouldBe(WHOLE_APP, "Path"),
      () => login.Domain.ShouldBeNull("no Domain"),
      () => login.Secure.ShouldBeTrue("Secure"),
      () => login.HttpOnly.ShouldBeTrue("HttpOnly"),
      () => login.SameSite.ShouldBe("Lax", "SameSite"),
      () => login.Lifetime.ShouldNotBeNull("persistent: an expiry"),
      () => login.Lifetime.GetValueOrDefault().ShouldBeInRange(_loginLifetime - _tolerance, _loginLifetime + _tolerance, "kept 30 days"));
  }
}