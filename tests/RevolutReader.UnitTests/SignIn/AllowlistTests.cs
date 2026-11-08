using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The allowlist is one comma-separated setting, read as a list (c007 design.md D8): split on commas, entries trimmed.
/// Every address here is made up.
/// </summary>
public sealed class AllowlistTests {
  [Test]
  public void The_allowlists_entries_are_trimmed() =>
    Allowlist.Parse(" lucie@example.com, jana@example.com ,petr@example.com  ").Addresses
      .ShouldBe(["lucie@example.com", "jana@example.com", "petr@example.com"]);
}