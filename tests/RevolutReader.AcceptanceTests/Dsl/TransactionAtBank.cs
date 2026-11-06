namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as the bank lists it (spec bank-reads, GIVEN). Whatever a scenario does not give is absent at the bank:
/// no counterparty, no reference, no payment details. The driver writes it in the shape of the Mock ASPSP capture.
/// </summary>
/// <param name="Status">The bank's status: booked, pending, cancelled or rejected.</param>
/// <param name="Flow">Money out (spent) or in (received).</param>
/// <param name="Amount">As the bank states it: positive, the direction is <paramref name="Flow"/>.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Day">The one day the bank gives the transaction: its booking day when booked, its transaction day otherwise.</param>
/// <param name="Counterparty">The payee of money out, the payer of money in.</param>
/// <param name="Reference">The bank's entry reference.</param>
/// <param name="Details">The bank's payment details.</param>
public sealed record TransactionAtBank(
  StatusAtBank Status,
  MoneyFlow Flow,
  decimal Amount,
  string Currency,
  DateOnly Day,
  string? Counterparty,
  string? Reference,
  Lines Details) {
  public const string DEFAULT_CURRENCY = "EUR";

  /// <summary>Money spent: a payment of <paramref name="amount"/> on <paramref name="on"/>, to <paramref name="to"/>.</summary>
  public static TransactionAtBank Payment(StatusAtBank status, decimal amount, DateOnly on, string? to = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.Out, amount, currency, on, to, reference, details ?? Lines.None);
  }

  /// <summary>Money received: a transfer of <paramref name="amount"/> on <paramref name="on"/>, from <paramref name="from"/>.</summary>
  public static TransactionAtBank TransferReceived(StatusAtBank status, decimal amount, DateOnly on, string? from = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.In, amount, currency, on, from, reference, details ?? Lines.None);
  }
}

/// <summary>A transaction's status at the bank; only booked and pending ones come back from a read.</summary>
public enum StatusAtBank {
  Booked,
  Pending,
  Cancelled,
  Rejected,
}

/// <summary>Which way the money went.</summary>
public enum MoneyFlow {
  Out,
  In,
}