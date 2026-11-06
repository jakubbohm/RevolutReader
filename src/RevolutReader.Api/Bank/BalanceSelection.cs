using System.Globalization;

namespace RevolutReader.Api.Bank;

/// <summary>Which of the bank's balances is the account's balance (c004 design.md D3).</summary>
public static class BalanceSelection {
  /// <summary>The available balance, the one Revolut returns (D3).</summary>
  private const string AVAILABLE = "ITAV";

  /// <summary>As the bank writes an amount: <c>"1234.56"</c>, a minus sign when negative; no thousands separators.</summary>
  private const NumberStyles WIRE_AMOUNT = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

  /// <summary>
  /// The ITAV balance (the first, should the bank send more than one); none, or an amount that is not a number →
  /// <see cref="BankReadException"/>, whose message carries no bank data (D4, § Error model).
  /// </summary>
  public static Balance Available(EbBalances balances) {
    ArgumentNullException.ThrowIfNull(balances);

    EbBalance available = balances.Balances.FirstOrDefault(static balance => string.Equals(balance.BalanceType, AVAILABLE, StringComparison.Ordinal))
      ?? throw new BankReadException($"The bank's balances hold no available ({AVAILABLE}) balance.");

    // TryParse, not Parse: a FormatException's message would quote the amount.
    if (!decimal.TryParse(available.BalanceAmount.Amount, WIRE_AMOUNT, CultureInfo.InvariantCulture, out decimal amount))
      throw new BankReadException($"The bank's available ({AVAILABLE}) balance has an amount that is not a decimal number.");

    return new Balance(amount, available.BalanceAmount.Currency);
  }
}