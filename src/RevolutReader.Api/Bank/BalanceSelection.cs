namespace RevolutReader.Api.Bank;

/// <summary>Which of the bank's balances is the account's balance (c004 design.md D3).</summary>
public static class BalanceSelection {
  /// <summary>The available balance, the one Revolut returns (D3).</summary>
  private const string AVAILABLE = "ITAV";

  /// <summary>
  /// The ITAV balance (the first, should the bank send more than one); none, an amount that is missing or not a number,
  /// or a missing currency → <see cref="BankReadException"/>, whose message carries no bank data (D4, § Error model).
  /// </summary>
  public static Balance Available(EbBalances balances) {
    ArgumentNullException.ThrowIfNull(balances);

    EbBalance available = balances.Balances.FirstOrDefault(static balance => string.Equals(balance.BalanceType, AVAILABLE, StringComparison.Ordinal))
      ?? throw new BankReadException($"The bank's balances hold no available ({AVAILABLE}) balance.");

    // The amount and its currency may be missing at the bank, whatever their annotations: System.Text.Json does not enforce them.
    if (available.BalanceAmount is not { } balanceAmount || !WireAmount.TryParse(balanceAmount.Amount, out decimal amount))
      throw new BankReadException($"The bank's available ({AVAILABLE}) balance has no amount, or one that is not a decimal number.");

    if (balanceAmount.Currency is null)
      throw new BankReadException($"The bank's available ({AVAILABLE}) balance has no currency.");

    return new Balance(amount, balanceAmount.Currency);
  }
}