using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The notification for a change (c014 design.md D2, the owner's Q8): a fall is titled "Odešlo" with the size of the change,
/// last seen − last notified, without a sign; the text is last seen with its koruna value at last seen's own rate; a tap
/// opens the app's start page; two balances that do not differ make no notification, a caller's bug. The spacing is the
/// board's: a no-break space (U+00A0, written <c> </c> here) before "€" and "Kč", after "≈" and between thousands; an
/// ordinary space after "Odešlo" and "Zůstatek" and before "("; U+2212 for a minus (written <c>−</c>). Last notified
/// was read an hour before last seen, at another rate, so a text built from it, or from its rate, fails. A rise is tasks.md
/// group 18's. Amounts are given as invariant text, since an attribute cannot hold a decimal; they are made up.
/// </summary>
public sealed class ChangeNotificationTests {
  /// <summary>When last seen was read.</summary>
  private static readonly DateTimeOffset _lastSeenReadAt = new(2026, 11, 21, 9, 14, 3, TimeSpan.Zero);

  /// <summary>Last seen's rate, C13's: the one its koruna value is worked out at.</summary>
  private const decimal LAST_SEEN_RATE = 24.3m;

  /// <summary>Last notified's rate, another one, which no text may use.</summary>
  private const decimal LAST_NOTIFIED_RATE = 25.0m;

  /// <param name="lastNotified">Last notified's amount, in euros.</param>
  /// <param name="lastSeen">Last seen's amount, in euros: lower.</param>
  /// <param name="title">The notification's title.</param>
  [Test]
  [Arguments("49.00", "45.20", "Odešlo 3,80 €")] // the board's example
  [Arguments("45.21", "45.20", "Odešlo 0,01 €")] // a cent, the least change
  [Arguments("2500.00", "1265.44", "Odešlo 1 234,56 €")] // its thousands grouped
  [Arguments("2.00", "-3.00", "Odešlo 5,00 €")] // below zero: the size, without a sign
  public void A_fall_is_titled_Odeslo_with_the_size_of_the_change(string lastNotified, string lastSeen, string title) =>
    ChangeNotification.For(Balances(lastSeen, lastNotified)).Title.ShouldBe(title);

  /// <param name="lastNotified">Last notified's amount, in euros.</param>
  /// <param name="lastSeen">Last seen's amount, in euros: the new balance.</param>
  /// <param name="text">The notification's text.</param>
  [Test]
  [Arguments("49.00", "45.20", "Zůstatek 45,20 € (≈ 1 098 Kč)")] // the board's example
  [Arguments("2500.00", "1234.56", "Zůstatek 1 234,56 € (≈ 30 000 Kč)")] // thousands in both: 29 999.808
  [Arguments("2.00", "-3.00", "Zůstatek −3,00 € (≈ 73 Kč)")] // a negative balance keeps its minus; its koruna value is its size, 72.9
  public void The_text_is_the_new_balance_with_its_koruna_value(string lastNotified, string lastSeen, string text) =>
    ChangeNotification.For(Balances(lastSeen, lastNotified)).Text.ShouldBe(text);

  [Test]
  public void The_notification_opens_the_apps_start_page() =>
    ChangeNotification.For(Balances(lastSeen: "45.20", lastNotified: "49.00")).Page.ShouldBe("/");

  /// <param name="lastSeen">Last seen's amount, in euros.</param>
  /// <param name="lastNotified">Last notified's amount, in euros: the same, or less than a cent away.</param>
  [Test]
  [Arguments("45.20", "45.20")] // the same amount
  [Arguments("45.205", "45.20")] // half a cent: no change (D4)
  public void Two_balances_that_do_not_differ_make_no_notification(string lastSeen, string lastNotified) =>
    Should.Throw<ArgumentException>(() => ChangeNotification.For(Balances(lastSeen, lastNotified)));

  /// <summary>The check's two balances: last seen read at <see cref="_lastSeenReadAt"/> at C13's rate, last notified an hour earlier at another rate.</summary>
  private static CheckedBalances Balances(string lastSeen, string lastNotified) => new(
    LastSeen: new AccountBalance(Euros(lastSeen), _lastSeenReadAt, LAST_SEEN_RATE),
    LastNotified: new AccountBalance(Euros(lastNotified), _lastSeenReadAt.AddHours(-1), LAST_NOTIFIED_RATE));

  private static decimal Euros(string amount) => decimal.Parse(amount, NumberStyles.Number, CultureInfo.InvariantCulture);
}