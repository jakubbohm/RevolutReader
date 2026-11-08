using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A 403 names the account's own email only when the allowlist refuses that account (ADR-0003 item 7, ADR-0004; c007
/// design.md D3), so the no-access screen can say which account has no access. Any other 403 for a signed-in user names
/// nothing: here an allowed user's write that the rule against writes from other sites refuses (D4), when a page of
/// another app on the hosting domain makes her browser send the sign-out. The main case, a stranger refused with their
/// own email, is the scenario "A stranger who signs in is refused, with their own email". A rule, not a scenario.
/// </summary>
public sealed class RefusedAccountEmailTests : AcceptanceTest {
  /// <summary>The problem description's extension that names the refused account (D3).</summary>
  private const string EMAIL = "email";

  /// <summary>A page of another app on the same hosting domain (made up).</summary>
  private const string ANOTHER_APP_ON_THE_HOSTING_DOMAIN = "https://jina-appka.example.net";

  [Test]
  public async Task A_write_refused_by_the_cross_site_rule_does_not_name_the_signed_in_users_email() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    IReadOnlyList<string>? members = await SignInDriver.SignOutRefusalMembers(ANOTHER_APP_ON_THE_HOSTING_DOMAIN);

    members.ShouldNotBeNull("the sign-out is refused with the problem description Forbidden");
    members.Where(static member => string.Equals(member, EMAIL, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("The refusal's members naming an email, though the allowlist does not refuse this account");
  }
}