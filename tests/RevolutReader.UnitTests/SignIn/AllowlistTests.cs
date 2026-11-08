using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The allowlist is one comma-separated setting, read as a list (c007 design.md D8): split on commas, entries trimmed.
/// An account is allowed when its email address is on the list, compared ignoring case; an account without one is not
/// (D3). Every address here is made up.
/// </summary>
public sealed class AllowlistTests {
  /// <summary>Two entries, the second written in mixed case, so a check covers more than the first entry and both directions of letter case.</summary>
  private static readonly Allowlist _lucieAndJana = Allowlist.Parse("lucie@example.com, Jana.Novakova@Example.com");

  [Test]
  public void The_allowlists_entries_are_trimmed() =>
    Allowlist.Parse(" lucie@example.com, jana@example.com ,petr@example.com  ").Addresses
      .ShouldBe(["lucie@example.com", "jana@example.com", "petr@example.com"]);

  [Test]
  [Arguments("lucie@example.com")]
  [Arguments("Jana.Novakova@Example.com")]
  public void An_address_on_the_allowlist_is_allowed(string email) => _lucieAndJana.Allows(email).ShouldBeTrue();

  [Test]
  [Arguments("LUCIE@EXAMPLE.COM")]
  [Arguments("jana.novakova@example.com")]
  public void An_address_on_the_allowlist_written_in_other_letter_case_is_allowed(string email) => _lucieAndJana.Allows(email).ShouldBeTrue();

  [Test]
  [Arguments("cizi.ucet@example.com")]
  [Arguments("lucie@example.co")] // the start of an entry
  [Arguments("alucie@example.com")] // ends with an entry
  public void An_address_not_on_the_allowlist_is_not_allowed(string email) => _lucieAndJana.Allows(email).ShouldBeFalse();

  [Test]
  [Arguments("no email address")]
  [Arguments("an empty email address")]
  public void An_account_without_an_email_address_is_not_allowed(string account) {
    string? email = account switch {
      "no email address" => null,
      "an empty email address" => string.Empty,
      _ => throw new ArgumentOutOfRangeException(nameof(account), account, "Not a known case."),
    };

    _lucieAndJana.Allows(email).ShouldBeFalse();
  }
}