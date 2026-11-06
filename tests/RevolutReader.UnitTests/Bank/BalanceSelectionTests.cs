using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// The account's balance is the bank's available balance, <c>ITAV</c>, with its amount and currency (spec bank-reads,
/// c004 design.md D3); a list without one is a bug, not a result (D4, § Error model), and the error carries no bank data.
/// The amounts are made up, in the Mock ASPSP capture's shape: the amount is a string on the wire.
/// </summary>
public sealed class BalanceSelectionTests {
  [Test]
  public void The_available_balance_is_the_ITAV_balance_with_its_amount_and_currency() {
    EbBalances balances = new([
      new(new("EUR", "1311.47"), "CLBD"),
      new(new("EUR", "1234.56"), "ITAV"),
      new(new("CZK", "30852.90"), "XPCD"),
    ]);

    BalanceSelection.Available(balances).ShouldBe(new Balance(1234.56m, "EUR"));
  }

  [Test]
  [Arguments("no balances at all")]
  [Arguments("other balance types only")]
  public void A_balance_list_without_an_ITAV_balance_is_an_error(string list) {
    EbBalances balances = list switch {
      "no balances at all" => new([]),
      "other balance types only" => new([
        new(new("EUR", "1311.47"), "CLBD"),
        new(new("CZK", "30852.90"), "XPCD"),
      ]),
      _ => throw new ArgumentOutOfRangeException(nameof(list), list, "Not a known case."),
    };

    BankReadException error = Should.Throw<BankReadException>(() => BalanceSelection.Available(balances));

    string[] bankData = [.. balances.Balances.SelectMany(static balance => new[] { balance.BalanceAmount.Amount, balance.BalanceAmount.Currency })];

    bankData.ShouldAllBe(value => !error.Message.Contains(value, StringComparison.OrdinalIgnoreCase), "the error's message carries no amount or currency from the list");
  }

  /// <summary>
  /// The error is checked as it would be logged (message, inner exceptions, stack trace): <c>decimal.Parse</c> quotes its
  /// input in its <c>FormatException</c>, so even a wrapped one would carry the amount (D5).
  /// </summary>
  [Test]
  [Arguments("12x34.56")]
  [Arguments("")]
  public void An_available_balance_whose_amount_is_not_a_number_is_an_error_and_the_message_does_not_contain_it(string amount) {
    EbBalances balances = new([new(new("EUR", amount), "ITAV")]);

    BankReadException error = Should.Throw<BankReadException>(() => BalanceSelection.Available(balances));

    string[] bankData = [.. new[] { amount, "EUR" }.Where(static value => value.Length > 0)];

    bankData.ShouldAllBe(value => !error.ToString().Contains(value, StringComparison.Ordinal), "the error carries neither the amount nor the currency");
  }
}