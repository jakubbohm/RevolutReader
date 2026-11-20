using System.Security.Claims;
using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The account a request is recorded under in the request telemetry (roadmap C14; ADR-0009-application-telemetry, Decision
/// item 7): an allowed account's email address, as its login gives it; nothing for a request without a login, a login
/// without an email address, or an account that is not on the allowlist. Every address here is made up.
/// </summary>
public sealed class RequestAccountTests {
  /// <summary>The login cookie's scheme, as a signed-in user's identity carries it; any non-empty name makes the identity authenticated.</summary>
  private const string LOGIN = "Cookies";

  /// <summary>The claim the allowlist check reads (c007 design.md D3).</summary>
  private const string EMAIL = "email";

  private static readonly Allowlist _lucieAndJana = Allowlist.Parse("lucie@example.com, Jana.Novakova@Example.com");

  [Test]
  public void An_allowed_accounts_request_is_recorded_under_its_email_address() =>
    RequestAccount.Of(LoginWith("lucie@example.com"), _lucieAndJana).ShouldBe("lucie@example.com");

  [Test]
  public void An_allowed_account_is_recorded_with_its_address_as_the_login_gives_it() =>
    RequestAccount.Of(LoginWith("jana.novakova@example.com"), _lucieAndJana).ShouldBe("jana.novakova@example.com");

  [Test]
  public void A_request_of_an_account_not_on_the_allowlist_is_recorded_under_no_account() =>
    RequestAccount.Of(LoginWith("cizi.ucet@example.com"), _lucieAndJana).ShouldBeNull();

  [Test]
  public void A_request_without_a_login_is_recorded_under_no_account() =>
    RequestAccount.Of(new ClaimsPrincipal(new ClaimsIdentity()), _lucieAndJana).ShouldBeNull();

  [Test]
  public void A_login_without_an_email_address_is_recorded_under_no_account() =>
    RequestAccount.Of(new ClaimsPrincipal(new ClaimsIdentity([new Claim("name", "Lucie Nováková")], LOGIN)), _lucieAndJana).ShouldBeNull();

  private static ClaimsPrincipal LoginWith(string email) => new(new ClaimsIdentity([new Claim(EMAIL, email)], LOGIN));
}