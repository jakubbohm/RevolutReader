using System.Globalization;
using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The page rules (c010 design.md D1, D3, D10), pure: the newest page's window, and where the live read starts. The days
/// are written out, never computed from the class's own constants: they are the rule the screen and the scenarios count on.
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

  /// <param name="newestKeptDay">
  /// Inside the last 31 days of 2026-11-20: yesterday, today itself, and the window's first day, 2026-10-20. The read then
  /// starts where the window does, and there is no gap (D3).
  /// </param>
  [Test]
  [Arguments("2026-11-19")]
  [Arguments("2026-11-20")]
  [Arguments("2026-10-20")]
  public void With_the_newest_kept_day_inside_the_last_31_days_the_read_starts_31_days_before_today(string newestKeptDay) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day("2026-10-20"), GapDays: null));

  /// <param name="newestKeptDay">
  /// Earlier than 31 days before 2026-11-20 but not earlier than 89 days: the day before the window's first, the long
  /// pause of the spec's scenario, and exactly 89 days back (2026-08-23). The read starts on that day, read again because
  /// more of its transactions may have settled since, and there is no gap (D3).
  /// </param>
  [Test]
  [Arguments("2026-10-19")]
  [Arguments("2026-09-30")]
  [Arguments("2026-08-23")]
  public void With_the_newest_kept_day_earlier_than_31_days_back_the_read_starts_on_that_day(string newestKeptDay) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day(newestKeptDay), GapDays: null));

  /// <param name="newestKeptDay">Earlier than 89 days before 2026-11-20 (2026-08-23): by one day, by three, and by months.</param>
  /// <param name="gapDays">
  /// The gap D3 names, "longer than 89 days": the days from the newest kept day to today. The days the read cannot reach,
  /// and so are lost unless a history file covers them, are those before 2026-08-23 and after the newest kept day.
  /// </param>
  [Test]
  [Arguments("2026-08-22", 90)]
  [Arguments("2026-08-20", 92)]
  [Arguments("2026-05-01", 203)]
  public void With_the_newest_kept_day_earlier_than_89_days_back_the_read_starts_89_days_back_and_reports_the_gaps_days(string newestKeptDay, int gapDays) =>
    TransactionPaging.LiveReadStart(Day("2026-11-20"), Day(newestKeptDay)).ShouldBe(new LiveReadStart(Day("2026-08-23"), gapDays));

  /// <param name="today">The scenarios' today, and two whose 89 days back cross a year's end and a short February.</param>
  /// <param name="readStart">89 days before it: as far back as the bank serves, with no gap reported, since nothing kept is missing (D3).</param>
  [Test]
  [Arguments("2026-11-20", "2026-08-23")]
  [Arguments("2027-01-15", "2026-10-18")]
  [Arguments("2026-03-01", "2025-12-02")]
  public void With_nothing_kept_the_read_starts_89_days_before_today(string today, string readStart) =>
    TransactionPaging.LiveReadStart(Day(today), newestKeptDay: null).ShouldBe(new LiveReadStart(Day(readStart), GapDays: null));

  private static DateOnly Day(string isoDate) => DateOnly.ParseExact(isoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}