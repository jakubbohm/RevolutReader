using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// A change is a difference of a cent or more between the check's two balances (c014 design.md D4: |last seen − last
/// notified| ≥ 0.01). Only the amounts count: in every case last notified was read an hour before last seen, at the same
/// rate. The amounts are made up.
/// </summary>
public sealed class CheckedBalancesTests {
  /// <summary>The rate both balances were read at, written out (c017 design.md D10): any rate does, as only the amounts count.</summary>
  private const decimal CZK_PER_EUR = 24.41m;

  /// <summary>When last seen was read.</summary>
  private static readonly DateTimeOffset _lastSeenReadAt = new(2026, 11, 21, 9, 14, 3, TimeSpan.Zero);

  /// <summary>When last notified was read: an hour earlier.</summary>
  private static readonly DateTimeOffset _lastNotifiedReadAt = _lastSeenReadAt.AddHours(-1);

  /// <param name="lastSeen">Last seen's amount, in euros, as invariant text (an attribute cannot hold a decimal).</param>
  /// <param name="lastNotified">Last notified's amount, in euros, as invariant text.</param>
  /// <param name="changed">Whether the two are a change.</param>
  [Test]
  [Arguments("45.20", "45.20", false)] // the same amount
  [Arguments("45.2", "45.20", false)] // the same amount, written with another scale
  [Arguments("45.205", "45.20", false)] // half a cent more
  [Arguments("45.20", "45.2099", false)] // just under a cent less
  [Arguments("-5.005", "-5.00", false)] // half a cent, below zero
  [Arguments("45.21", "45.20", true)] // a cent more
  [Arguments("45.19", "45.20", true)] // a cent less
  [Arguments("45.215", "45.205", true)] // exactly a cent, between amounts finer than cents
  [Arguments("-4.99", "-5.00", true)] // a cent, below zero
  [Arguments("45.20", "49.00", true)] // money out
  [Arguments("145.20", "45.20", true)] // money in
  public void Two_balances_that_differ_by_less_than_a_cent_are_no_change_by_a_cent_or_more_a_change(string lastSeen, string lastNotified, bool changed) {
    CheckedBalances balances = new(
      new AccountBalance(Euros(lastSeen), _lastSeenReadAt, CZK_PER_EUR),
      new AccountBalance(Euros(lastNotified), _lastNotifiedReadAt, CZK_PER_EUR));

    balances.Changed.ShouldBe(changed);
  }

  private static decimal Euros(string amount) => decimal.Parse(amount, NumberStyles.Number, CultureInfo.InvariantCulture);
}