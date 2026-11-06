namespace RevolutReader.Api.Bank;

/// <summary>Which of the bank's balances is the account's balance (c004 design.md D3).</summary>
public static class BalanceSelection {
  /// <summary>The ITAV balance; none → BankReadException.</summary>
  public static Balance Available(EbBalances balances) => throw new NotImplementedException();
}