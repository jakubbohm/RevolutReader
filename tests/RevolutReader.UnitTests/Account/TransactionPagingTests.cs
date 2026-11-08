using System.Globalization;
using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The page rules (c010 design.md D1, D3, D10), pure: the newest page's window. The days are written out, never computed
/// from the class's own constants: they are the rule the screen and the scenarios count on.
/// </summary>
public sealed class TransactionPagingTests {
  /// <param name="today">The scenarios' today, and two whose 31 days back cross a short February and a year's end.</param>
  /// <param name="windowStart">31 days before it: the newest page's first day.</param>
  [Test]
  [Arguments("2026-11-20", "2026-10-20")]
  [Arguments("2026-03-01", "2026-01-29")]
  [Arguments("2027-01-15", "2026-12-15")]
  public void The_window_starts_31_days_before_today(string today, string windowStart) =>
    TransactionPaging.WindowStart(Day(today)).ShouldBe(Day(windowStart));

  private static DateOnly Day(string isoDate) => DateOnly.ParseExact(isoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}